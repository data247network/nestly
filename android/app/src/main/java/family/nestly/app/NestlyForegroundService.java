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
