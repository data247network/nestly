package family.nestly.app;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;

/**
 * Native child -> cloud bridge used by the foreground service.
 *
 * The JavaScript agent is still the authoritative offline state machine, but
 * Android may throttle or kill its WebView. The foreground service therefore
 * keeps the cloud heartbeat alive and, importantly, consumes the latest policy
 * returned by child-sync so remote lock commands are not dependent on the
 * WebView being on screen.
 */
public class NestlyCloudUploader {

    private static final String TAG = "NestlyUpload";
    private static final String CAP_STORE = "CapacitorStorage";
    private static final String KEY_ENROLMENT = "nestly.enrolment";
    private static final String KEY_CHILD_STATE = "nestly.child.state";
    private static final String KEY_ENDPOINT = "nestly.cloud.endpoint";

    static final long INTERVAL_MS = 60_000L;
    static final long LOW_BATTERY_INTERVAL_MS = 5 * 60_000L;
    static final int LOW_BATTERY_PERCENT = 15;
    private static final int MAX_EVENTS = 40;

    private NestlyCloudUploader() {}

    static long intervalFor(int batteryPercent) {
        return batteryPercent >= 0 && batteryPercent <= LOW_BATTERY_PERCENT
                ? LOW_BATTERY_INTERVAL_MS
                : INTERVAL_MS;
    }

    static int runOnce(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(CAP_STORE, Context.MODE_PRIVATE);

        String endpoint = prefs.getString(KEY_ENDPOINT, null);
        String enrolmentRaw = prefs.getString(KEY_ENROLMENT, null);
        if (endpoint == null || enrolmentRaw == null) return readBattery(ctx);

        String childId;
        String deviceSecret;
        try {
            JSONObject enrolment = new JSONObject(enrolmentRaw);
            childId = enrolment.optString("childId", "");
            deviceSecret = enrolment.optString("deviceSecret", "");
        } catch (Exception e) {
            return readBattery(ctx);
        }
        if (childId.isEmpty() || deviceSecret.isEmpty()) return readBattery(ctx);

        int battery = readBattery(ctx);
        JSONObject body = new JSONObject();
        try {
            body.put("childId", childId);
            body.put("deviceSecret", deviceSecret);
            body.put("telemetry", telemetry(ctx, battery));
            JSONArray events = pendingEvents(prefs);
            if (events.length() > 0) body.put("events", events);
        } catch (Exception e) {
            return battery;
        }

        JSONObject response = post(endpoint, body.toString());
        if (response != null) applyRemotePolicy(ctx, response.optJSONObject("policy"));
        return battery;
    }

    /**
     * Telemetry reflects the policy currently known locally. In particular it
     * must never hard-code locked=false: doing so allowed the native uploader to
     * overwrite a true lock in child_telemetry every minute.
     */
    private static JSONObject telemetry(Context ctx, int battery) throws Exception {
        JSONObject t = new JSONObject();
        t.put("ts", System.currentTimeMillis());
        t.put("battery", battery >= 0 ? battery : JSONObject.NULL);
        t.put("charging", isCharging(ctx));

        JSONObject policy = readLocalPolicy(ctx);
        boolean locked = policy != null && isPolicyLocked(policy);
        t.put("locked", locked);
        t.put("activeScenarioId", activeScenarioId(policy));

        Location best = lastLocation(ctx);
        if (best != null) {
            JSONObject fix = new JSONObject();
            fix.put("lat", best.getLatitude());
            fix.put("lng", best.getLongitude());
            fix.put("acc", best.hasAccuracy() ? best.getAccuracy() : 0);
            t.put("fix", fix);
        } else {
            t.put("fix", JSONObject.NULL);
        }
        return t;
    }

    private static JSONObject readLocalPolicy(Context ctx) {
        try {
            String raw = ctx.getSharedPreferences(CAP_STORE, Context.MODE_PRIVATE)
                    .getString(KEY_CHILD_STATE, null);
            if (raw == null) return null;
            return new JSONObject(raw).optJSONObject("policy");
        } catch (Exception e) {
            return null;
        }
    }

    /** Parent lock-now or a currently active scheduled scenario. */
    private static boolean isPolicyLocked(JSONObject policy) {
        if (policy == null) return false;
        if (policy.optBoolean("lockNow", false)) return true;
        return activeScenarioId(policy) != null;
    }

    private static String activeScenarioId(JSONObject policy) {
        if (policy == null) return null;
        JSONArray scenarios = policy.optJSONArray("scenarios");
        if (scenarios == null) return null;

        Calendar now = Calendar.getInstance();
        // Java: Sunday=1..Saturday=7. Protocol: Monday=0..Sunday=6.
        int day = (now.get(Calendar.DAY_OF_WEEK) + 5) % 7;
        int minute = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);

        for (int i = 0; i < scenarios.length(); i++) {
            JSONObject s = scenarios.optJSONObject(i);
            if (s == null || !s.optBoolean("enabled", false)) continue;
            JSONArray days = s.optJSONArray("days");
            if (days == null || !contains(days, day)) continue;
            int from = s.optInt("fromMin", 0);
            int to = s.optInt("toMin", 0);
            boolean active = from <= to
                    ? minute >= from && minute < to
                    : minute >= from || minute < to;
            if (active) return s.optString("id", null);
        }
        return null;
    }

    private static boolean contains(JSONArray a, int value) {
        for (int i = 0; i < a.length(); i++) if (a.optInt(i, -1) == value) return true;
        return false;
    }

    /** Apply the server's latest policy immediately, without requiring WebView JS. */
    private static void applyRemotePolicy(Context ctx, JSONObject policy) {
        if (policy == null) return;
        boolean locked = isPolicyLocked(policy);
        if (!NestlyLockOverlay.canDraw(ctx)) return;

        if (!locked) {
            NestlyLockOverlay.hide();
            return;
        }

        String title = policy.optBoolean("lockNow", false)
                ? "Phone locked"
                : "Phone locked";
        String subtitle = "A routine is running.";
        JSONArray scenarios = policy.optJSONArray("scenarios");
        String activeId = activeScenarioId(policy);
        if (activeId != null && scenarios != null) {
            for (int i = 0; i < scenarios.length(); i++) {
                JSONObject s = scenarios.optJSONObject(i);
                if (s != null && activeId.equals(s.optString("id", null))) {
                    subtitle = s.optString("name", subtitle) + " is running.";
                    break;
                }
            }
        } else if (policy.optBoolean("lockNow", false)) {
            subtitle = "Locked by your parent.";
        }

        java.util.List<String[]> contacts = new java.util.ArrayList<>();
        JSONArray rawContacts = policy.optJSONArray("contacts");
        if (rawContacts != null) {
            for (int i = 0; i < rawContacts.length(); i++) {
                JSONObject c = rawContacts.optJSONObject(i);
                if (c == null) continue;
                String name = c.optString("name", "");
                String phone = c.optString("phone", "");
                if (!phone.trim().isEmpty()) contacts.add(new String[] { name, phone });
            }
        }

        NestlyLockOverlay.hide();
        NestlyLockOverlay.show(ctx, title, subtitle, contacts);
    }

    private static Location lastLocation(Context ctx) {
        if (ctx.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED
                && ctx.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) return null;
        try {
            LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return null;
            Location gps = null, net = null;
            try { gps = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER); } catch (Exception ignored) {}
            try { net = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER); } catch (Exception ignored) {}
            if (gps == null) return net;
            if (net == null) return gps;
            return gps.getTime() >= net.getTime() ? gps : net;
        } catch (Exception e) {
            return null;
        }
    }

    private static JSONArray pendingEvents(SharedPreferences prefs) {
        JSONArray out = new JSONArray();
        String raw = prefs.getString(KEY_CHILD_STATE, null);
        if (raw == null) return out;
        try {
            JSONArray log = new JSONObject(raw).optJSONArray("log");
            if (log == null) return out;
            for (int i = 0; i < log.length() && i < MAX_EVENTS; i++) out.put(log.getJSONObject(i));
        } catch (Exception e) {
            Log.w(TAG, "could not read child state: " + e.getMessage());
        }
        return out;
    }

    private static int readBattery(Context ctx) {
        try {
            BatteryManager bm = (BatteryManager) ctx.getSystemService(Context.BATTERY_SERVICE);
            if (bm == null) return -1;
            int level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            return level >= 0 && level <= 100 ? level : -1;
        } catch (Exception e) {
            return -1;
        }
    }

    private static boolean isCharging(Context ctx) {
        try {
            Intent status = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (status == null) return false;
            return status.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0;
        } catch (Exception e) {
            return false;
        }
    }

    private static JSONObject post(String endpoint, String json) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(endpoint).openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(20_000);
            conn.setDoOutput(true);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(json.getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            InputStream input = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (input == null) return null;
            StringBuilder text = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) text.append(line);
            }
            if (code / 100 != 2) {
                Log.w(TAG, "upload rejected: " + code);
                return null;
            }
            return new JSONObject(text.toString());
        } catch (Exception e) {
            Log.d(TAG, "upload failed: " + e.getMessage());
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
