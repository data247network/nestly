package family.nestly.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * Keeps the Nestly child agent alive.
 *
 * Two things depend on this. BLE advertising and the GATT server are torn down
 * by the system once the hosting process is cached, and location updates stop
 * being delivered to a backgrounded app. A foreground service is the only
 * supported way to keep either running, and from Android 14 it must declare
 * exactly which types it is for.
 *
 * The notification is not optional decoration — Android requires it, and it is
 * also the honest thing to show: the child can always see that the agent is
 * running, which is the same promise the transparency screen makes.
 */
public class NestlyForegroundService extends Service {

    /**
     * The cloud uploader lives here rather than in the WebView.
     *
     * A WebView's timers are throttled the moment the app leaves the screen and
     * stop once the process goes idle, so the JavaScript agent only ever
     * uploaded in the seconds after someone opened the app. This service is
     * already kept alive for BLE and location, which makes it the one place on
     * a child's phone that reliably gets to run.
     *
     * Its own thread: the work is a blocking HTTP request, and the main thread
     * is where the notification and the rest of the app live.
     */
    private HandlerThread uploadThread;
    private Handler uploadHandler;

    private final Runnable uploadTick = new Runnable() {
        @Override
        public void run() {
            int battery = -1;
            try {
                battery = NestlyCloudUploader.runOnce(getApplicationContext());
            } catch (Throwable t) {
                // Never let an upload take the service down with it. The child
                // being supervised does not depend on the cloud, and a crash
                // loop here would stop BLE and location too.
            }
            if (uploadHandler != null) {
                uploadHandler.postDelayed(this, NestlyCloudUploader.intervalFor(battery));
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
        Notification notification = buildNotification(text);
        startUploads();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14 rejects a foreground service whose declared type does
            // not match what it actually does.
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                            | ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // Restart if the system reclaims us: an agent that silently stops is
        // worse than one that never started, because the parent sees stale data
        // and assumes it is current.
        return START_STICKY;
    }

    /** Idempotent: onStartCommand runs again on every restart and re-delivery. */
    private void startUploads() {
        if (uploadThread != null) return;
        uploadThread = new HandlerThread("nestly-upload");
        uploadThread.start();
        uploadHandler = new Handler(uploadThread.getLooper());
        // Immediately, then on its own cadence. The first run matters most:
        // it is the one that catches up whatever accumulated while the phone
        // was asleep.
        uploadHandler.post(uploadTick);
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
                // LOW: persistent, but never makes a sound. This sits in the
                // shade all day; anything higher would be hostile.
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Shows while Nestly is looking after this phone.");
        channel.setShowBadge(false);
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

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
