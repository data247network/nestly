package family.nestly.app;

import android.Manifest;
import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;

/** Native bridge for Android Enterprise Device Owner / LockTask enforcement. */
public final class NestlyDeviceOwner {
    private NestlyDeviceOwner() {}

    public static ComponentName admin(Context context) {
        return NestlyDeviceAdmin.component(context);
    }

    public static DevicePolicyManager dpm(Context context) {
        return (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
    }

    public static boolean isDeviceOwner(Context context) {
        DevicePolicyManager manager = dpm(context);
        return manager != null && manager.isDeviceOwnerApp(context.getPackageName());
    }

    public static boolean isLockTaskPermitted(Context context) {
        if (!isDeviceOwner(context)) return false;
        DevicePolicyManager manager = dpm(context);
        try {
            return manager.isLockTaskPermitted(context.getPackageName());
        } catch (SecurityException ignored) {
            return false;
        }
    }

    /** Allow Nestly to enter kiosk-style LockTask when it is Device Owner. */
    public static boolean configure(Context context) {
        if (!isDeviceOwner(context)) return false;
        DevicePolicyManager manager = dpm(context);
        try {
            manager.setLockTaskPackages(admin(context), new String[]{context.getPackageName()});
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                manager.setLockTaskFeatures(admin(context), DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
            }
            // School Lock must never remove the child's ability to call the
            // parent-configured safety contacts. Device Owner can grant this
            // runtime permission without exposing the Phone app or dialler.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                manager.setPermissionGrantState(
                        admin(context),
                        context.getPackageName(),
                        Manifest.permission.CALL_PHONE,
                        DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED);
            }
            return true;
        } catch (SecurityException ignored) {
            return false;
        }
    }

    public static boolean lock(Activity activity) {
        Context context = activity.getApplicationContext();
        if (!configure(context) || !isLockTaskPermitted(context)) return false;
        try {
            activity.startLockTask();
            return true;
        } catch (SecurityException | IllegalArgumentException ignored) {
            return false;
        }
    }

    public static boolean unlock(Activity activity) {
        if (!isDeviceOwner(activity)) return false;
        try {
            activity.stopLockTask();
            return true;
        } catch (SecurityException | IllegalStateException ignored) {
            return false;
        }
    }

    public static Intent provisioningHelpIntent() {
        return new Intent(Settings.ACTION_SECURITY_SETTINGS);
    }
}
