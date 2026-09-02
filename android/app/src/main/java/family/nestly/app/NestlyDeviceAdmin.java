package family.nestly.app;

import android.app.admin.DeviceAdminReceiver;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/**
 * Android Enterprise admin receiver.
 *
 * Legacy Device Admin is retained only as a compatibility fallback. Real
 * production management is Device Owner + LockTask; a legacy admin alone is
 * explicitly not treated as uninstall-proof.
 */
public class NestlyDeviceAdmin extends DeviceAdminReceiver {
    static final String PREFS = "nestly.tamper";
    static final String KEY_ADMIN_OFF_AT = "adminDisabledAt";
    static final String KEY_DEVICE_OWNER_CONFIGURED_AT = "deviceOwnerConfiguredAt";

    public static ComponentName component(Context ctx) {
        return new ComponentName(ctx, NestlyDeviceAdmin.class);
    }

    public static boolean isActive(Context ctx) {
        DevicePolicyManager dpm =
                (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
        return dpm != null && dpm.isAdminActive(component(ctx));
    }

    public static Intent enableIntent(Context ctx) {
        Intent i = new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
        i.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, component(ctx));
        i.putExtra(
                DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                "Nestly uses device administration to provide safety controls. "
                        + "On fully managed devices, Nestly uses Android Device Owner for stronger protection.");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return i;
    }

    @Override
    public CharSequence onDisableRequested(Context context, Intent intent) {
        return "Turning off Nestly protection allows the safety component to be removed and will be reported to the parent.";
    }

    @Override
    public void onDisabled(Context context, Intent intent) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putLong(KEY_ADMIN_OFF_AT, System.currentTimeMillis()).apply();
    }

    /** Called by Android Enterprise after Device Owner provisioning completes. */
    @Override
    public void onProfileProvisioningComplete(Context context, Intent intent) {
        super.onProfileProvisioningComplete(context, intent);
        boolean configured = NestlyDeviceOwner.configure(context);
        if (configured) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putLong(KEY_DEVICE_OWNER_CONFIGURED_AT, System.currentTimeMillis())
                    .apply();
        }
    }
}
