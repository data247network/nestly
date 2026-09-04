package family.nestly.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

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
 * Native background command transport for the child device.
 *
 * Architecture v2 keeps lock commands out of the WebView-only polling path.
 * This small foreground service polls the authenticated child command endpoint
 * and performs the one enforcement action that must work while the app UI is
 * closed: DevicePolicyManager.lockNow(). The server-side command claim is
 * filtered to the native transport so the JavaScript pump continues to own
 * locate/unlock/refresh commands.
 *
 * This is intentionally boring and defensive: no account token is stored here;
 * the existing per-device child secret is read from Capacitor Preferences,
 * which is the same private Android SharedPreferences store used by the app.
 */
public class NestlyCommandService extends Service {
    private static final String TAG = "NestlyCommand";
    private static final String CAP_STORE = "CapacitorStorage";
    private static final String KEY_ENROLMENT = "nestly.enrolment";
    private static final String CHANNEL_ID = "nestly-command-agent";
    private static final int NOTIFICATION_ID = 1003;
    private static final long POLL_MS = 5_000L;
    private static final String COMMAND_URL =
            "https://toebajpgzhanrrvyhwmc.supabase.co/functions/v1/child-command-sync";

    private HandlerThread thread;
    private Handler handler;
    private volatile boolean stopped;

    private final Runnable pollTick = new Runnable() {
        @Override public void run() {
            if (stopped) return;
            try {
                pollOnce();
            } catch (Throwable t) {
                Log.w(TAG, "command poll failed", t);
            }
            if (!stopped && handler != null) handler.postDelayed(this, POLL_MS);
        }
    };

    public static void start(Context context) {
        Intent intent = new Intent(context, NestlyCommandService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "unable to start command service", e);
        }
    }

    @Override public void onCreate() {
        super.onCreate();
        createChannel();
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Nestly protection is active")
                .setContentText("Keeping remote safety commands available.")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        thread = new HandlerThread("nestly-command");
        thread.start();
        handler = new Handler(thread.getLooper());
        handler.post(pollTick);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override public void onDestroy() {
        stopped = true;
        if (handler != null) handler.removeCallbacksAndMessages(null);
        if (thread != null) thread.quitSafely();
        handler = null;
        thread = null;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private void pollOnce() throws Exception {
        SharedPreferences prefs = getSharedPreferences(CAP_STORE, MODE_PRIVATE);
        String raw = prefs.getString(KEY_ENROLMENT, null);
        if (raw == null) return;

        JSONObject enrolment = new JSONObject(raw);
        String childId = enrolment.optString("childId", "");
        String secret = enrolment.optString("deviceSecret", "");
        if (childId.isEmpty() || secret.isEmpty()) return;

        JSONObject request = new JSONObject();
        request.put("childId", childId);
        request.put("deviceSecret", secret);
        request.put("transport", "native-lock");

        JSONObject response = post(COMMAND_URL, request.toString());
        if (!response.optBoolean("ok", false)) return;
        JSONArray commands = response.optJSONArray("commands");
        if (commands == null) return;

        for (int i = 0; i < commands.length(); i++) {
            JSONObject command = commands.optJSONObject(i);
            if (command == null) continue;
            String id = command.optString("id", "");
            String name = command.optString("command", "");
            if (id.isEmpty()) continue;
            if (!"lock".equals(name)) {
                acknowledge(childId, secret, id, "failed", result("unsupported_native_command", name));
                continue;
            }
            executeLock(childId, secret, id);
        }
    }

    private void executeLock(String childId, String secret, String id) {
        JSONObject result = new JSONObject();
        try {
            if (!NestlyDeviceOwner.isDeviceOwner(this)) {
                result.put("ok", false);
                result.put("error", "device_owner_required");
                result.put("deviceOwner", false);
                acknowledge(childId, secret, id, "failed", result);
                return;
            }

            NestlyDeviceOwner.configure(this);
            DevicePolicyManager dpm = NestlyDeviceOwner.dpm(this);
            if (dpm == null || !NestlyDeviceOwner.isLockTaskPermitted(this)) {
                result.put("ok", false);
                result.put("error", "lock_task_not_permitted");
                result.put("deviceOwner", true);
                acknowledge(childId, secret, id, "failed", result);
                return;
            }

            result.put("ok", true);
            result.put("deviceOwner", true);
            result.put("enforcement", "device_policy_lock_now");
            acknowledge(childId, secret, id, "applied", result);

            // lockNow() is the native background-capable enforcement primitive.
            // Unlike startLockTask(), it does not require an Activity instance.
            dpm.lockNow();

            result.put("locked", true);
            result.put("acknowledged", true);
            acknowledge(childId, secret, id, "completed", result);
        } catch (Throwable t) {
            try {
                result.put("ok", false);
                result.put("error", t.getClass().getSimpleName());
                result.put("message", String.valueOf(t.getMessage()));
            } catch (Exception ignored) {}
            acknowledge(childId, secret, id, "failed", result);
        }
    }

    private JSONObject result(String error, String command) {
        JSONObject out = new JSONObject();
        try { out.put("ok", false); out.put("error", error); out.put("command", command); }
        catch (Exception ignored) {}
        return out;
    }

    private void acknowledge(String childId, String secret, String id, String status, JSONObject result) {
        try {
            JSONObject ack = new JSONObject();
            ack.put("id", id);
            ack.put("status", status);
            ack.put("result", result);
            JSONObject body = new JSONObject();
            body.put("childId", childId);
            body.put("deviceSecret", secret);
            body.put("transport", "native-lock");
            JSONArray acks = new JSONArray();
            acks.put(ack);
            body.put("ack", acks);
            post(COMMAND_URL, body.toString());
        } catch (Exception e) {
            Log.w(TAG, "command acknowledgement failed", e);
        }
    }

    private JSONObject post(String endpoint, String body) throws Exception {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(endpoint).openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(8_000);
            conn.setReadTimeout(12_000);
            conn.setDoOutput(true);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            InputStream stream = code >= 200 && code < 400 ? conn.getInputStream() : conn.getErrorStream();
            String text = read(stream);
            if (code < 200 || code >= 300) return new JSONObject();
            return text == null || text.isEmpty() ? new JSONObject() : new JSONObject(text);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String read(InputStream stream) {
        if (stream == null) return null;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder out = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null && out.length() < 16_000) out.append(line);
            return out.toString();
        } catch (Exception ignored) { return null; }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Nestly remote protection", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Keeps remote safety commands available on this child device.");
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }
}
