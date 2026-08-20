package family.nestly.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/** Starts the child cloud heartbeat after reboot or APK replacement. */
public class NestlyBootReceiver extends BroadcastReceiver {
    private static final String CAP_STORE = "CapacitorStorage";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;

        SharedPreferences prefs = context.getSharedPreferences(CAP_STORE, Context.MODE_PRIVATE);
        String role = prefs.getString("nestly.role", "");
        String enrolment = prefs.getString("nestly.enrolment", null);
        if (!"child".equals(role) || enrolment == null || enrolment.isEmpty()) return;

        NestlyForegroundService.start(context, "Looking after this phone.");
    }
}
