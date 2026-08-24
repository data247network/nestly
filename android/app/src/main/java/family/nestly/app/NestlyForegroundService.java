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
 * BLE, location and the native cloud uploader all depend on this service. The
 * service is deliberately promoted to foreground before any uploader work is
 * scheduled, so a slow device or a future uploader change cannot jeopardise
 * Android's foreground-start deadline.
 */
public class NestlyForegroundService extends Service {

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
