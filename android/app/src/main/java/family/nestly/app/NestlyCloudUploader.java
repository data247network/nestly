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

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Uploads the child's state to the cloud from native code.
 *
 * The JavaScript agent already does this, and for a while that looked like
 * enough. It is not: a WebView's timers are throttled the moment the app leaves
 * the screen and stop altogether once Android decides the process is idle. The
 * evidence was in the data — ten `agent-start` events and nothing between them,
 * because the only uploads that ever happened were the ones in the seconds
 * after someone opened the app. A child's phone in a pocket, which is the
 * normal case and the one the product exists for, was silent for eleven hours.
 *
 * This runs in the foreground service instead, which Android keeps alive
 * precisely so that BLE and location keep working, and is therefore the one
 * place on the child's phone that reliably gets to run.
 *
 * WRITE-ONLY AND IDEMPOTENT, deliberately. It never mutates the state the
 * JavaScript agent owns — no trimming the log, no advancing a cursor, no
 * writing back. It reads what the agent last persisted and posts it. The server
 * upserts events on `(child_id, seq)` and ignores duplicates, so re-sending the
 * same backlog costs a request and changes nothing. That property is what makes
 * two uploaders safe to run against one log; anything cleverer would need
 * locking between a Java service and a JavaScript timer, which is a race
 * waiting to be written.
 */
public class NestlyCloudUploader {

    private static final String TAG = "NestlyUpload";

    /** Capacitor Preferences keeps everything in this SharedPreferences file. */
    private static final String CAP_STORE = "CapacitorStorage";

    private static final String KEY_ENROLMENT = "nestly.enrolment";
    private static final String KEY_CHILD_STATE = "nestly.child.state";
    private static final String KEY_ENDPOINT = "nestly.cloud.endpoint";

    /** Matches the JavaScript cadence so the two paths cannot disagree. */
    static final long INTERVAL_MS = 60_000L;
    static final long LOW_BATTERY_INTERVAL_MS = 5 * 60_000L;
    static final int LOW_BATTERY_PERCENT = 15;

    /** The server caps at 200; sending less keeps a backlog flush cheap. */
    private static final int MAX_EVENTS = 40;

    private NestlyCloudUploader() {}

    /** How long to wait before the next attempt, given the battery. */
    static long intervalFor(int batteryPercent) {
        return batteryPercent >= 0 && batteryPercent <= LOW_BATTERY_PERCENT
                ? LOW_BATTERY_INTERVAL_MS
                : INTERVAL_MS;
    }

    /**
     * One upload attempt. Blocking — call it off the main thread.
     *
     * @return the battery percentage it observed, or -1 when unknown, so the
     *         caller can pace the next run without reading it twice.
     */
    static int runOnce(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(CAP_STORE, Context.MODE_PRIVATE);

        String endpoint = prefs.getString(KEY_ENDPOINT, null);
        String enrolmentRaw = prefs.getString(KEY_ENROLMENT, null);
        if (endpoint == null || enrolmentRaw == null) return readBattery(ctx);

        String childId;
        String deviceSecret;
        try {
            // Capacitor stores JSON.stringify output, so a string value arrives
            // wrapped in quotes and an object arrives as an object.
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

        post(endpoint, body.toString());
        return battery;
    }

    /**
     * Position and battery, from the system rather than from the agent.
     *
     * `getLastKnownLocation` rather than requesting a fresh fix: the plugin
     * already has updates running while the service is alive, so the cached
     * value is recent, and asking for a new one here would wake the GPS on a
     * timer that exists to be cheap.
     */
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
                != PackageManager.PERMISSION_GRANTED) {
            return null;
        }
        try {
            LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return null;
            Location gps = null;
            Location net = null;
            try {
                gps = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            } catch (Exception ignored) {
            }
            try {
                net = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            } catch (Exception ignored) {
            }
            if (gps == null) return net;
            if (net == null) return gps;
            // Newer wins. A stale GPS fix from the last time the child was
            // outdoors is worse than a fresh coarse one from a cell tower.
            return gps.getTime() >= net.getTime() ? gps : net;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * The events the agent has recorded and not yet had acknowledged.
     *
     * Read straight out of the agent's persisted state. Nothing is removed —
     * only the parent's ack over Bluetooth may trim that log, and stealing that
     * job here would lose history the radio has not delivered yet.
     */
    private static JSONArray pendingEvents(SharedPreferences prefs) {
        JSONArray out = new JSONArray();
        String raw = prefs.getString(KEY_CHILD_STATE, null);
        if (raw == null) return out;
        try {
            JSONArray log = new JSONObject(raw).optJSONArray("log");
            if (log == null) return out;
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
            int plugged = status.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
            return plugged != 0;
        } catch (Exception e) {
            return false;
        }
    }

    private static void post(String endpoint, String json) {
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
            if (code / 100 != 2) Log.w(TAG, "upload rejected: " + code);
        } catch (Exception e) {
            // Offline is the normal state for this product, not an error worth
            // retrying tightly. The next tick tries again.
            Log.d(TAG, "upload failed: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
