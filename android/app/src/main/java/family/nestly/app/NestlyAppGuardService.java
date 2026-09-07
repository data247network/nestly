package family.nestly.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.util.Calendar;
import java.util.List;

/**
 * Per-app time caps, individual app lock, and PEGI filtering.
 *
 * WHY POLLING. Seeing which app is in the foreground without root needs
 * either an AccessibilityService — heavier Play Store review scope, and this
 * app has never asked for that permission — or Usage Access, which Nestly
 * already holds for the screen-time report. Polling on top of the same call
 * {@code getUsageToday} already makes needs no new permission at all.
 *
 * HONEST LIMITS. This cannot react inside the second an app opens — there is
 * a poll-interval window where a capped or locked app is visible before the
 * block appears. That is the wrong failure mode for real-time content
 * filtering, but the right one for a daily minutes cap or an evening lock,
 * which is all this claims to be.
 */
public class NestlyAppGuardService extends Service {

    private static final String TAG = "NestlyAppGuard";
    private static final String CHANNEL_ID = "nestly-app-guard";
    private static final int NOTIFICATION_ID = 1003;
    private static final long POLL_INTERVAL_MS = 3000;

    public static final String ACTION_STOP = "family.nestly.app.APP_GUARD_STOP";

    private static volatile AppGuardRules rules = new AppGuardRules();

    private HandlerThread thread;
    private Handler handler;
    /** Rolling cursor so each poll only reads events since the last one. */
    private long eventsQueriedTo = 0;
    private String foregroundPkg;
    private String blockedPkg;

    public static void setRules(AppGuardRules next) {
        rules = next == null ? new AppGuardRules() : next;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }

        createChannel();
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        startPolling();
        return START_STICKY;
    }

    private void startPolling() {
        if (thread != null) return;
        thread = new HandlerThread("nestly-app-guard");
        thread.start();
        handler = new Handler(thread.getLooper());
        handler.post(tick);
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            try {
                evaluate();
            } catch (Throwable t) {
                Log.w(TAG, "tick failed", t);
            }
            if (handler != null) handler.postDelayed(this, POLL_INTERVAL_MS);
        }
    };

    private void evaluate() {
        AppGuardRules r = rules;
        updateForegroundPackage();

        if (r.isEmpty() || foregroundPkg == null || foregroundPkg.equals(getPackageName())) {
            clearBlock();
            return;
        }

        String reason = decide(r, foregroundPkg);
        if (reason == null) {
            clearBlock();
            return;
        }
        if (!foregroundPkg.equals(blockedPkg)) {
            String label = labelFor(foregroundPkg);
            NestlyAppBlockOverlay.show(this, foregroundPkg, titleFor(reason), subtitleFor(reason, label));
            blockedPkg = foregroundPkg;
        }
    }

    private void clearBlock() {
        if (blockedPkg != null) {
            NestlyAppBlockOverlay.hide();
            blockedPkg = null;
        }
    }

    private String decide(AppGuardRules r, String pkg) {
        AppGuardRules.Rule rule = r.byPackage.get(pkg);
        if (rule != null && rule.locked) return "locked";
        if (rule != null && rule.capMinutes > 0 && minutesToday(pkg) >= rule.capMinutes) return "capped";
        if (r.maxPegi > 0) {
            int pegi = PegiRatings.ratingFor(pkg);
            // Unrated (0) is never auto-blocked by the ceiling alone.
            if (pegi > 0 && pegi > r.maxPegi) return "pegi";
        }
        return null;
    }

    private String titleFor(String reason) {
        switch (reason) {
            case "locked": return "This app is locked";
            case "capped": return "Time's up for today";
            case "pegi": return "Not allowed yet";
            default: return "This app is blocked";
        }
    }

    private String subtitleFor(String reason, String label) {
        switch (reason) {
            case "locked": return label + " was locked by your parent.";
            case "capped": return "You've used up today's time for " + label + ".";
            case "pegi": return label + " is rated for an older age.";
            default: return "Ask your parent to unlock " + label + ".";
        }
    }

    /**
     * Advances a running foreground-app tracker rather than re-deriving it
     * from scratch each tick. Querying only the events since the last poll
     * means an app that has stayed open for minutes is not lost the moment
     * its MOVE_TO_FOREGROUND event falls outside a fixed lookback window.
     */
    private void updateForegroundPackage() {
        UsageStatsManager usm = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
        if (usm == null) return;
        long end = System.currentTimeMillis();
        long start = eventsQueriedTo == 0 ? end - 5000 : eventsQueriedTo;
        eventsQueriedTo = end;

        UsageEvents events = usm.queryEvents(start, end);
        UsageEvents.Event event = new UsageEvents.Event();
        while (events.hasNextEvent()) {
            events.getNextEvent(event);
            if (event.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND) {
                foregroundPkg = event.getPackageName();
            } else if (event.getEventType() == UsageEvents.Event.MOVE_TO_BACKGROUND
                    && event.getPackageName().equals(foregroundPkg)) {
                foregroundPkg = null;
            }
        }
    }

    /** Same INTERVAL_DAILY query NestlyLinkPlugin#getUsageToday already makes, for one package. */
    private int minutesToday(String pkg) {
        UsageStatsManager usm = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
        if (usm == null) return 0;
        Calendar midnight = Calendar.getInstance();
        midnight.set(Calendar.HOUR_OF_DAY, 0);
        midnight.set(Calendar.MINUTE, 0);
        midnight.set(Calendar.SECOND, 0);
        midnight.set(Calendar.MILLISECOND, 0);

        List<UsageStats> stats = usm.queryUsageStats(
                UsageStatsManager.INTERVAL_DAILY, midnight.getTimeInMillis(), System.currentTimeMillis());
        long ms = 0;
        if (stats != null) {
            for (UsageStats s : stats) {
                if (pkg.equals(s.getPackageName())) ms += s.getTotalTimeInForeground();
            }
        }
        return (int) (ms / 60_000);
    }

    private String labelFor(String pkg) {
        try {
            return getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(pkg, 0)).toString();
        } catch (Exception e) {
            return pkg;
        }
    }

    @Override
    public void onDestroy() {
        if (handler != null) handler.removeCallbacksAndMessages(null);
        if (thread != null) thread.quitSafely();
        handler = null;
        thread = null;
        clearBlock();
        super.onDestroy();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "App limits", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shows while Nestly is checking app time limits.");
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Nestly is checking app limits")
                .setSmallIcon(R.mipmap.ic_launcher)
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
