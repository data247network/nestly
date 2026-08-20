package family.nestly.app;

import android.app.AppOpsManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Native child -> cloud bridge used by the foreground service.
 *
 * The JavaScript agent remains the offline state machine, but Android may
 * throttle or kill its WebView. This service therefore keeps telemetry, events,
 * usage and notes moving while the app is backgrounded, and consumes the latest
 * policy returned by child-sync so remote lock commands do not depend on the
 * WebView being visible.
 */
public class NestlyCloudUploader {

    private static final String TAG = "NestlyUpload";
    private static final String CAP_STORE = "CapacitorStorage";
    private static final String KEY_ENROLMENT = "nestly.enrolment";
    private static final String KEY_CHILD_STATE = "nestly.child.state";
    private static final String KEY_NOTES = "nestly.notes";
    private static final String KEY_ENDPOINT = "nestly.cloud.endpoint";

    static final long INTERVAL_MS = 60_000L;
    static final long LOW_BATTERY_INTERVAL_MS = 5 * 60_000L;
    static final int LOW_BATTERY_PERCENT = 15;
    private static final int MAX_EVENTS = 40;
    private static final int MAX_NOTES = 20;

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

            JSONArray notes = pendingChildNotes(prefs);
            if (notes.length() > 0) body.put("notes", notes);

            JSONArray pendingNoteIds = pendingNoteIds(prefs);
            if (pendingNoteIds.length() > 0) body.put("notePending", pendingNoteIds);
            body.put("wantNotes", true);
            body.put("usage", usageToday(ctx));
        } catch (Exception e) {
            return battery;
        }

        JSONObject response = post(endpoint, body.toString());
        if (response != null) {
            applyRemotePolicy(ctx, response.optJSONObject("policy"));
            applyNoteResponse(prefs, response);
            // A successful upload means the server has durably accepted the
            // submitted batch. Keep the local event log for Bluetooth replay;
            // the JS agent remains responsible for trimming its own history.
        }
        return battery;
    }

    /** Telemetry must never hard-code locked=false or overwrite a true remote lock. */
    private static JSONObject telemetry(Context ctx, int battery) throws Exception {
        JSONObject t = new JSONObject();
        t.put("ts", System.currentTimeMillis());
        t.put("battery", battery >= 0 ? battery : JSONObject.NULL);
        t.put("charging", isCharging(ctx));
        JSONObject policy = readLocalPolicy(ctx);
        t.put("locked", policy != null && isPolicyLocked(policy));
        String active = activeScenarioId(policy);
        t.put("activeScenarioId", active == null ? JSONObject.NULL : active);

        Location best = lastLocation(ctx);
        if (best != null) {
            JSONObject fix = new JSONObject();
            fix.put("lat", best.getLatitude());
            fix.put("lng", best.getLongitude());
            fix.put("acc", best.hasAccuracy() ? best.getAccuracy() : 0);
            t.put("fix", fix);
        } else t.put("fix", JSONObject.NULL);
        return t;
    }

    private static JSONObject readLocalPolicy(Context ctx) {
        try {
            String raw = ctx.getSharedPreferences(CAP_STORE, Context.MODE_PRIVATE)
                    .getString(KEY_CHILD_STATE, null);
            return raw == null ? null : new JSONObject(raw).optJSONObject("policy");
        } catch (Exception e) {
            return null;
        }
    }

    private static boolean isPolicyLocked(JSONObject policy) {
        return policy != null && (policy.optBoolean("lockNow", false) || activeScenarioId(policy) != null);
    }

    private static String activeScenarioId(JSONObject policy) {
        if (policy == null) return null;
        JSONArray scenarios = policy.optJSONArray("scenarios");
        if (scenarios == null) return null;
        Calendar now = Calendar.getInstance();
        int day = (now.get(Calendar.DAY_OF_WEEK) + 5) % 7;
        int minute = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);
        for (int i = 0; i < scenarios.length(); i++) {
            JSONObject s = scenarios.optJSONObject(i);
            if (s == null || !s.optBoolean("enabled", false)) continue;
            JSONArray days = s.optJSONArray("days");
            if (days == null || !contains(days, day)) continue;
            int from = s.optInt("fromMin", 0);
            int to = s.optInt("toMin", 0);
            boolean active = from <= to ? minute >= from && minute < to : minute >= from || minute < to;
            if (active) return s.optString("id", null);
        }
        return null;
    }

    private static boolean contains(JSONArray a, int value) {
        for (int i = 0; i < a.length(); i++) if (a.optInt(i, -1) == value) return true;
        return false;
    }

    /** Apply the server policy immediately, including remote lock/unlock. */
    private static void applyRemotePolicy(Context ctx, JSONObject policy) {
        if (policy == null || !NestlyLockOverlay.canDraw(ctx)) return;
        boolean locked = isPolicyLocked(policy);
        if (!locked) {
            NestlyLockOverlay.hide();
            return;
        }

        String subtitle = policy.optBoolean("lockNow", false) ? "Locked by your parent." : "A routine is running.";
        JSONArray scenarios = policy.optJSONArray("scenarios");
        String activeId = activeScenarioId(policy);
        if (activeId != null && scenarios != null) {
            for (int i = 0; i < scenarios.length(); i++) {
                JSONObject s = scenarios.optJSONObject(i);
                if (s != null && activeId.equals(s.optString("id", null))) {
                    subtitle = s.optString("name", "A routine") + " is running.";
                    break;
                }
            }
        }

        java.util.List<String[]> contacts = new java.util.ArrayList<>();
        JSONArray rawContacts = policy.optJSONArray("contacts");
        if (rawContacts != null) {
            for (int i = 0; i < rawContacts.length(); i++) {
                JSONObject c = rawContacts.optJSONObject(i);
                if (c == null) continue;
                String phone = c.optString("phone", "");
                if (!phone.trim().isEmpty()) contacts.add(new String[] { c.optString("name", ""), phone });
            }
        }
        NestlyLockOverlay.hide();
        NestlyLockOverlay.show(ctx, "Phone locked", subtitle, contacts);
    }

    /** Build the replaceable daily screen-time snapshot. */
    private static JSONObject usageToday(Context ctx) throws Exception {
        JSONObject usage = new JSONObject();
        usage.put("day", localDay());
        usage.put("apps", usageApps(ctx));
        usage.put("sites", usageSites());
        usage.put("usageAccess", usageAccessGranted(ctx));
        usage.put("filterOn", NestlyFilterService.isRunning());
        return usage;
    }

    private static JSONArray usageApps(Context ctx) {
        JSONArray out = new JSONArray();
        if (!usageAccessGranted(ctx)) return out;
        try {
            Calendar midnight = Calendar.getInstance();
            midnight.set(Calendar.HOUR_OF_DAY, 0);
            midnight.set(Calendar.MINUTE, 0);
            midnight.set(Calendar.SECOND, 0);
            midnight.set(Calendar.MILLISECOND, 0);
            UsageStatsManager usm = (UsageStatsManager) ctx.getSystemService(Context.USAGE_STATS_SERVICE);
            List<UsageStats> stats = usm.queryUsageStats(
                    UsageStatsManager.INTERVAL_DAILY,
                    midnight.getTimeInMillis(),
                    System.currentTimeMillis());
            PackageManager pm = ctx.getPackageManager();
            Map<String, Long> totals = new HashMap<>();
            if (stats != null) {
                for (UsageStats s : stats) {
                    long ms = s.getTotalTimeInForeground();
                    if (ms >= 60_000 && !s.getPackageName().equals(ctx.getPackageName())) {
                        totals.put(s.getPackageName(), (totals.containsKey(s.getPackageName()) ? totals.get(s.getPackageName()) : 0L) + ms);
                    }
                }
            }
            for (Map.Entry<String, Long> e : totals.entrySet()) {
                JSONObject a = new JSONObject();
                a.put("pkg", e.getKey());
                a.put("label", labelFor(pm, e.getKey()));
                a.put("minutes", (int) (e.getValue() / 60_000));
                a.put("category", categoryFor(e.getKey()));
                out.put(a);
                if (out.length() >= 200) break;
            }
        } catch (Exception e) {
            Log.w(TAG, "usage query failed", e);
        }
        return out;
    }

    private static JSONArray usageSites() {
        JSONArray out = new JSONArray();
        for (String[] v : NestlyFilterService.snapshotVisits()) {
            try {
                JSONObject s = new JSONObject();
                s.put("domain", v[0]);
                s.put("count", Integer.parseInt(v[1]));
                s.put("lastAt", Long.parseLong(v[2]));
                s.put("blocked", "1".equals(v[3]));
                if (v.length > 4 && v[4] != null && !v[4].isEmpty()) s.put("cat", v[4]);
                out.put(s);
            } catch (Exception ignored) {}
            if (out.length() >= 300) break;
        }
        return out;
    }

    private static String localDay() {
        Calendar c = Calendar.getInstance();
        return String.format(java.util.Locale.US, "%04d-%02d-%02d",
                c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    private static boolean usageAccessGranted(Context ctx) {
        try {
            AppOpsManager ops = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
            if (ops == null) return false;
            int mode = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q
                    ? ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), ctx.getPackageName())
                    : ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), ctx.getPackageName());
            return mode == AppOpsManager.MODE_ALLOWED;
        } catch (Exception e) {
            return false;
        }
    }

    private static String labelFor(PackageManager pm, String pkg) {
        try { return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString(); }
        catch (Exception e) { return pkg; }
    }

    private static String categoryFor(String pkg) {
        String p = pkg.toLowerCase(java.util.Locale.US);
        if (p.contains("instagram") || p.contains("tiktok") || p.contains("snapchat")
                || p.contains("facebook") || p.contains("twitter") || p.contains("whatsapp")
                || p.contains("discord") || p.contains("reddit") || p.contains("telegram")) return "social";
        if (p.contains("game") || p.contains("minecraft") || p.contains("roblox")) return "games";
        return "other";
    }

    private static JSONArray pendingEvents(SharedPreferences prefs) {
        JSONArray out = new JSONArray();
        try {
            String raw = prefs.getString(KEY_CHILD_STATE, null);
            if (raw == null) return out;
            JSONArray log = new JSONObject(raw).optJSONArray("log");
            if (log == null) return out;
            for (int i = 0; i < log.length() && i < MAX_EVENTS; i++) out.put(log.getJSONObject(i));
        } catch (Exception e) { Log.w(TAG, "could not read child state: " + e.getMessage()); }
        return out;
    }

    private static JSONArray pendingChildNotes(SharedPreferences prefs) {
        JSONArray out = new JSONArray();
        try {
            String raw = prefs.getString(KEY_NOTES, null);
            if (raw == null) return out;
            JSONArray notes = new JSONArray(raw);
            for (int i = 0; i < notes.length() && out.length() < MAX_NOTES; i++) {
                JSONObject n = notes.optJSONObject(i);
                if (n == null || !"child".equals(n.optString("from"))) continue;
                if (n.optBoolean("synced", false) || n.optBoolean("delivered", false)) continue;
                JSONObject wire = new JSONObject();
                wire.put("id", n.optString("id"));
                wire.put("text", n.optString("text"));
                wire.put("ts", n.optLong("ts", System.currentTimeMillis()));
                out.put(wire);
            }
        } catch (Exception e) { Log.w(TAG, "could not read notes: " + e.getMessage()); }
        return out;
    }

    private static JSONArray pendingNoteIds(SharedPreferences prefs) {
        JSONArray out = new JSONArray();
        try {
            String raw = prefs.getString(KEY_NOTES, null);
            if (raw == null) return out;
            JSONArray notes = new JSONArray(raw);
            for (int i = 0; i < notes.length() && out.length() < 100; i++) {
                JSONObject n = notes.optJSONObject(i);
                if (n != null && "child".equals(n.optString("from")) && !n.optBoolean("delivered", false)) {
                    out.put(n.optString("id"));
                }
            }
        } catch (Exception ignored) {}
        return out;
    }

    private static void applyNoteResponse(SharedPreferences prefs, JSONObject response) {
        try {
            String raw = prefs.getString(KEY_NOTES, "[]");
            JSONArray local = new JSONArray(raw);
            Map<String, JSONObject> byId = new HashMap<>();
            for (int i = 0; i < local.length(); i++) {
                JSONObject n = local.optJSONObject(i);
                if (n != null) byId.put(n.optString("id"), n);
            }

            JSONArray delivered = response.optJSONArray("noteDelivered");
            if (delivered != null) {
                for (int i = 0; i < delivered.length(); i++) {
                    JSONObject n = byId.get(delivered.optString(i));
                    if (n != null) n.put("delivered", true);
                }
            }

            JSONArray incoming = response.optJSONArray("notes");
            if (incoming != null) {
                for (int i = 0; i < incoming.length(); i++) {
                    JSONObject r = incoming.optJSONObject(i);
                    if (r == null) continue;
                    String id = r.optString("id");
                    JSONObject existing = byId.get(id);
                    if (existing == null) {
                        existing = new JSONObject();
                        existing.put("id", id);
                        existing.put("from", "parent");
                        existing.put("text", r.optString("text"));
                        existing.put("ts", r.optLong("ts", System.currentTimeMillis()));
                        existing.put("delivered", true);
                        existing.put("synced", true);
                        local.put(existing);
                        byId.put(id, existing);
                    } else {
                        existing.put("delivered", true);
                    }
                }
            }

            // A successful child upload is enough to mark the submitted child
            // notes as server-synced; delivery to the parent is separate.
            if (response.optJSONObject("accepted") != null
                    && "ok".equals(response.optJSONObject("accepted").optString("notes"))) {
                for (JSONObject n : byId.values()) {
                    if ("child".equals(n.optString("from"))) n.put("synced", true);
                }
            }
            prefs.edit().putString(KEY_NOTES, local.toString()).apply();
        } catch (Exception e) {
            Log.w(TAG, "could not merge notes: " + e.getMessage());
        }
    }

    private static Location lastLocation(Context ctx) {
        if (ctx.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && ctx.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return null;
        try {
            LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return null;
            Location gps = null, net = null;
            try { gps = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER); } catch (Exception ignored) {}
            try { net = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER); } catch (Exception ignored) {}
            if (gps == null) return net;
            if (net == null) return gps;
            return gps.getTime() >= net.getTime() ? gps : net;
        } catch (Exception e) { return null; }
    }

    private static int readBattery(Context ctx) {
        try {
            BatteryManager bm = (BatteryManager) ctx.getSystemService(Context.BATTERY_SERVICE);
            if (bm == null) return -1;
            int level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            return level >= 0 && level <= 100 ? level : -1;
        } catch (Exception e) { return -1; }
    }

    private static boolean isCharging(Context ctx) {
        try {
            Intent status = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            return status != null && status.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0;
        } catch (Exception e) { return false; }
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
            try (OutputStream os = conn.getOutputStream()) { os.write(json.getBytes(StandardCharsets.UTF_8)); }
            int code = conn.getResponseCode();
            InputStream input = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (input == null) return null;
            StringBuilder text = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
                String line; while ((line = r.readLine()) != null) text.append(line);
            }
            if (code / 100 != 2) { Log.w(TAG, "upload rejected: " + code); return null; }
            return new JSONObject(text.toString());
        } catch (Exception e) {
            Log.d(TAG, "upload failed: " + e.getMessage());
            return null;
        } finally { if (conn != null) conn.disconnect(); }
    }
}
