package family.nestly.app;

import android.app.admin.DeviceAdminReceiver;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/**
 * Uninstall resistance, and an honest account of its limits.
 *
 * An active device administrator cannot be uninstalled. Android refuses, and
 * sends the user to Settings to deactivate it first — which is the point: it
 * turns "tap and hold, uninstall" into a deliberate, multi-step act that this
 * app finds out about.
 *
 * WHAT THIS IS NOT. It is not a lock on the phone. A child who wants the app
 * gone can deactivate this in Settings and then uninstall. Only Device Owner
 * provisioning genuinely prevents that, and it requires a factory reset and
 * enrolment from first boot — not something a family will do to a phone that is
 * already in use.
 *
 * So the design goal is not prevention, which is unattainable. It is that
 * nothing can be turned off quietly. `onDisableRequested` warns, and
 * `onDisabled` records the fact so the parent is told within seconds — a speed
 * bump with a witness.
 */
public class NestlyDeviceAdmin extends DeviceAdminReceiver {

    /** Where a tamper is left for the agent to pick up on its next tick. */
    static final String PREFS = "nestly.tamper";
    static final String KEY_ADMIN_OFF_AT = "adminDisabledAt";

    public static ComponentName component(Context ctx) {
        return new ComponentName(ctx, NestlyDeviceAdmin.class);
    }

    public static boolean isActive(Context ctx) {
        DevicePolicyManager dpm =
                (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
        return dpm != null && dpm.isAdminActive(component(ctx));
    }

    /** The system screen that asks the user to turn protection on. */
    public static Intent enableIntent(Context ctx) {
        Intent i = new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
        i.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, component(ctx));
        i.putExtra(
                DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                "Nestly asks for this so the app cannot be removed without your parent knowing. "
                        + "It does not give anyone access to your messages, photos or accounts.");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return i;
    }

    /**
     * Shown by Android on the confirmation screen when someone tries to turn
     * this off. It cannot block the action — no app can — so it is written to
     * be informative rather than threatening.
     */
    @Override
    public CharSequence onDisableRequested(Context context, Intent intent) {
        return "Turning this off lets Nestly be uninstalled, and tells your parent it happened.";
    }

    @Override
    public void onDisabled(Context context, Intent intent) {
        // Recorded rather than reported from here: a broadcast receiver is a
        // poor place to do network work, and the agent is already the thing
        // that owns the event log and the uplink.
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putLong(KEY_ADMIN_OFF_AT, System.currentTimeMillis()).apply();
    }
}
