package family.nestly.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Keeps the Nestly child agent alive and surfaces important app updates.
 *
 * The foreground service is already the long-lived native process on a child
 * device, so it is also the reliable place to notice a newer sideloaded APK
 * while the WebView is closed. It never installs silently: the notification
 * opens Nestly, where the normal verified installer flow asks the user to
 * confirm the Android installation.
 */
public class NestlyForegroundService extends Service {

    private static final String UPDATE_CHANNEL_ID = "nestly-updates";
    private static final int UPDATE_NOTIFICATION_ID = 1002;
    private static final String UPDATE_MANIFEST_URL =
            "https://nestly-gamma-seven.vercel.app/downloads/latest.json";
    private static final long UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L;
    private static final String PREFS = "nestly_update_notice";
    private static final String LAST_NOTIFIED_CODE = "last_notified_version_code";

    private HandlerThread uploadThread;
    private Handler uploadHandler;

    private final Runnable uploadTick = new Runnable() {
        @Override
        public void run() {
            int battery = -1;
            try {
                battery = NestlyCloudUploader.runOnce(getApplicationContext());
            } catch (Throwable t) {
                // Cloud sync must never be able to take BLE/location down.
            }
            if (uploadHandler != null) {
                uploadHandler.postDelayed(this, NestlyCloudUploader.intervalFor(battery));
            }
        }
    };

    private final Runnable updateCheckTick = new Runnable() {
        @Override
        public void run() {
            try {
                checkForUpdateNotice();
            } catch (Throwable ignored) {
                // Update checking is advisory and must never affect child sync.
            }
            if (uploadHandler != null) {
                uploadHandler.postDelayed(this, UPDATE_CHECK_INTERVAL_MS);
            }
        }
    };

    public static final String CHANNEL_ID = "nestly_agent";
    public static final int NOTIFICATION_ID = 1001;
    public static final String EXTRA_TEXT = "text";

    public static void start(Context context, String text) {
        Intent intent = new Intent(context, NestlyForegroundService.class);
        intent.putExtra(EXTRA_TEXT, text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, NestlyForegroundService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String text = intent != null && intent.getStringExtra(EXTRA_TEXT) != null
                ? intent.getStringExtra(EXTRA_TEXT)
                : "Keeping this phone connected to your family.";

        createChannel();
        createUpdateChannel();
        Notification notification = buildNotification(text);

        // Promote first. Android gives a foreground service only a short window
        // after startForegroundService(); do not spend that window initialising
        // background work.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                            | ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        startUploads();

        // Restart if Android reclaims the process. The service is also started
        // again whenever the child agent comes back to the foreground.
        return START_STICKY;
    }

    /** Idempotent: onStartCommand can be delivered more than once. */
    private void startUploads() {
        if (uploadThread != null) return;
        uploadThread = new HandlerThread("nestly-upload");
        uploadThread.start();
        uploadHandler = new Handler(uploadThread.getLooper());
        // Immediately catch up anything that accumulated while the phone was
        // asleep, then continue at the battery-aware cadence.
        uploadHandler.post(uploadTick);
        // Check for a newer APK without making the WebView responsible for it.
        uploadHandler.post(updateCheckTick);
    }

    @Override
    public void onDestroy() {
        if (uploadHandler != null) uploadHandler.removeCallbacksAndMessages(null);
        if (uploadThread != null) uploadThread.quitSafely();
        uploadHandler = null;
        uploadThread = null;
        super.onDestroy();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Nestly agent",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Shows while Nestly is looking after this phone.");
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    private void createUpdateChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(UPDATE_CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
                UPDATE_CHANNEL_ID,
                "App updates",
                NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Notifies you when a newer Nestly app is ready to install.");
        channel.setShowBadge(true);
        nm.createNotificationChannel(channel);
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, flags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Nestly is on")
                .setContentText(text)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pi)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
    }

    private void checkForUpdateNotice() {
        PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
        long currentCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode()
                : info.versionCode;

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(UPDATE_MANIFEST_URL + "?t=" + System.currentTimeMillis()).openConnection();
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestProperty("Accept", "application/json");
            conn.connect();

            if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) return;

            StringBuilder json = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) json.append(line);
            }

            JSONObject manifest = new JSONObject(json.toString());
            long availableCode = manifest.optLong("versionCode", 0);
            String versionName = manifest.optString("versionName", "");
            if (availableCode <= currentCode || versionName.isEmpty()) return;

            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            long lastNotified = prefs.getLong(LAST_NOTIFIED_CODE, 0);
            if (availableCode <= lastNotified) return;

            Intent open = new Intent(this, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getActivity(this, 1, open, flags);

            Notification notification = new NotificationCompat.Builder(this, UPDATE_CHANNEL_ID)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle("Nestly update available")
                    .setContentText("Version " + versionName + " is ready. Tap to update Nestly.")
                    .setStyle(new NotificationCompat.BigTextStyle()
                            .bigText("Version " + versionName + " is ready. Open Nestly to verify and install the current APK."))
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setCategory(NotificationCompat.CATEGORY_SYSTEM)
                    .build();

            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.notify(UPDATE_NOTIFICATION_ID, notification);
                prefs.edit().putLong(LAST_NOTIFIED_CODE, availableCode).apply();
            }
        } catch (Exception ignored) {
            // Offline or malformed update metadata is not a child-sync failure.
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
