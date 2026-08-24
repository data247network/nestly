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

/**
 * Uploads the child's state to the cloud from native code.
 *
 * The JavaScript agent owns the state and also uploads when its WebView is
 * active. This native path is the background safety net: it runs from the
 * foreground service so WebView timer throttling cannot make the child's
 * cloud record silently go stale.
 *
 * The uploader is deliberately write-only and idempotent. Events are resent
 * until the server acknowledges them; the server de-duplicates on
 * (child_id, seq). No local cursor is advanced here.
 */
public class NestlyCloudUploader {

    private static final String TAG = "NestlyUpload";
    private static final String CAP_STORE = "CapacitorStorage";
    private static final String KEY_ENROLMENT = "nestly.enrolment";
    private static final String KEY_CHILD_STATE = "nestly.child.state";
    private static final String KEY_ENDPOINT = "nestly.cloud.endpoint";
    private static final String KEY_SYNC_STATUS = "nestly.cloud.sync.status";

    /** Public Supabase project URL; native fallback if the WebView cannot start. */
    private static final String DEFAULT_ENDPOINT =
            "https://toebajpgzhanrrvyhwmc.supabase.co/functions/v1/child-sync";

    static final long INTERVAL_MS = 60_000L;
    static final long LOW_BATTERY_INTERVAL_MS = 5 * 60_000L;
    static final int LOW_BATTERY_PERCENT = 15;
    private static final int MAX_EVENTS = 40;
    private static final int MAX_RESPONSE_CHARS = 8_000;

    private NestlyCloudUploader() {}

    static long intervalFor(int batteryPercent) {
        return batteryPercent >= 0 && batteryPercent <= LOW_BATTERY_PERCENT
                ? LOW_BATTERY_INTERVAL_MS
                : INTERVAL_MS;
    }

    /** One upload attempt. Blocking — call it off the main thread. */
    static int runOnce(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(CAP_STORE, Context.MODE_PRIVATE);
        int battery = readBattery(ctx);
        long attemptAt = System.currentTimeMillis();
        recordAttempt(prefs, attemptAt);

        String endpoint = resolveEndpoint(prefs);
        String enrolmentRaw = prefs.getString(KEY_ENROLMENT, null);
        if (enrolmentRaw == null) {
            recordFailure(prefs, attemptAt, -1, "not_enrolled", null);
            return battery;
        }

        String childId;
        String deviceSecret;
        try {
            JSONObject enrolment = new JSONObject(enrolmentRaw);
            childId = enrolment.optString("childId", "");
            deviceSecret = enrolment.optString("deviceSecret", "");
        } catch (Exception e) {
            recordFailure(prefs, attemptAt, -1, "invalid_enrolment", e.getMessage());
            return battery;
        }
        if (childId.isEmpty() || deviceSecret.isEmpty()) {
            recordFailure(prefs, attemptAt, -1, "not_enrolled", null);
            return battery;
        }

        JSONObject body = new JSONObject();
        try {
            body.put("childId", childId);
            body.put("deviceSecret", deviceSecret);
            body.put("telemetry", telemetry(ctx, battery));
            JSONArray events = pendingEvents(prefs);
            if (events.length() > 0) body.put("events", events);
        } catch (Exception e) {
            recordFailure(prefs, attemptAt, -1, "payload_build_failed", e.getMessage());
            return battery;
        }

        post(prefs, endpoint, body.toString(), attemptAt);
        return battery;
    }

    /** Prefer the current endpoint, but reject retired/stale project URLs. */
    private static String resolveEndpoint(SharedPreferences prefs) {
        String configured = prefs.getString(KEY_ENDPOINT, null);
        if (configured != null && configured.startsWith("https://")
                && configured.contains("/functions/v1/child-sync")
                && configured.contains("toebajpgzhanrrvyhwmc.supabase.co")) {
            return configured;
        }
        return DEFAULT_ENDPOINT;
    }

    private static JSONObject telemetry(Context ctx, int battery) throws Exception {
        JSONObject t = new JSONObject();
        t.put("ts", System.currentTimeMillis());
        t.put("battery", battery >= 0 ? battery : JSONObject.NULL);
        t.put("charging", isCharging(ctx));
        t.put("activeScenarioId", JSONObject.NULL);
        t.put("locked", false);

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

    private static Location lastLocation(Context ctx) {
        if (ctx.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED
                && ctx.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) return null;
        try {
            LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return null;
            Location gps = null;
            Location net = null;
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
            // Always send the oldest prefix so eventsUpTo can advance safely.
            for (int i = 0; i < log.length() && i < MAX_EVENTS; i++) {
                out.put(log.getJSONObject(i));
            }
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

    private static void post(SharedPreferences prefs, String endpoint, String json, long attemptAt) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(endpoint).openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "Nestly-Android-Child-Sync/1.17");
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(15_000);
            conn.setDoOutput(true);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(json.getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            String response = readResponse(code >= 200 && code < 400
                    ? conn.getInputStream() : conn.getErrorStream());
            if (code >= 200 && code < 300) {
                recordSuccess(prefs, attemptAt, code, response);
                Log.d(TAG, "cloud sync ok: HTTP " + code);
            } else {
                recordFailure(prefs, attemptAt, code, "http_" + code, response);
                Log.w(TAG, "cloud sync rejected: HTTP " + code + " " + response);
            }
        } catch (Exception e) {
            recordFailure(prefs, attemptAt, -1, e.getClass().getSimpleName(), e.getMessage());
            Log.d(TAG, "cloud sync failed: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readResponse(InputStream stream) {
        if (stream == null) return null;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder out = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null && out.length() < MAX_RESPONSE_CHARS) {
                if (out.length() > 0) out.append('\n');
                out.append(line);
            }
            return out.toString();
        } catch (Exception ignored) {
            return null;
        }
    }

    private static void recordAttempt(SharedPreferences prefs, long now) {
        try {
            JSONObject s = readStatus(prefs);
            s.put("lastAttempt", now);
            prefs.edit().putString(KEY_SYNC_STATUS, s.toString()).apply();
        } catch (Exception ignored) {}
    }

    private static void recordSuccess(SharedPreferences prefs, long now, int code, String response) {
        try {
            JSONObject s = readStatus(prefs);
            s.put("lastAttempt", now);
            s.put("lastSuccess", now);
            s.put("status", code);
            s.remove("lastFailure");
            s.remove("error");
            if (response != null) s.put("response", response);
            prefs.edit().putString(KEY_SYNC_STATUS, s.toString()).apply();
        } catch (Exception ignored) {}
    }

    private static void recordFailure(SharedPreferences prefs, long now, int code,
                                      String error, String response) {
        try {
            JSONObject s = readStatus(prefs);
            s.put("lastAttempt", now);
            s.put("lastFailure", now);
            if (code >= 0) s.put("status", code);
            s.put("error", error);
            if (response != null) s.put("response", response);
            prefs.edit().putString(KEY_SYNC_STATUS, s.toString()).apply();
        } catch (Exception ignored) {}
    }

    private static JSONObject readStatus(SharedPreferences prefs) {
        try {
            String raw = prefs.getString(KEY_SYNC_STATUS, null);
            return raw == null ? new JSONObject() : new JSONObject(raw);
        } catch (Exception e) {
            return new JSONObject();
        }
    }
}
