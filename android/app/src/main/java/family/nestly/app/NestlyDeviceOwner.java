package family.nestly.app;

import android.Manifest;
import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.UserManager;
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

    /**
     * Apply the complete child-device policy. This is intentionally a no-op
     * unless Nestly is the Android Device Owner; legacy Device Admin remains a
     * fallback only and is never represented as equivalent protection.
     */
    public static boolean configure(Context context) {
        if (!isDeviceOwner(context)) return false;
        DevicePolicyManager manager = dpm(context);
        ComponentName admin = admin(context);
        String pkg = context.getPackageName();
        try {
            manager.setLockTaskPackages(admin, new String[]{pkg});
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                manager.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                manager.setPermissionGrantState(
                        admin, pkg, Manifest.permission.CALL_PHONE,
                        DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED);
            }

            // Device Owner is the actual uninstall/tamper boundary. These APIs
            // make the policy explicit rather than relying on a legacy admin.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                manager.setUninstallBlocked(admin, pkg, true);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                manager.setUserControlDisabledPackages(admin, java.util.Collections.singletonList(pkg));
            }

            // Prevent common escape routes from a managed child device. Do not
            // disable USB debugging here: development and recovery need a
            // controlled path, and production provisioning can add it later.
            manager.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT);
            manager.addUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET);
            manager.addUserRestriction(admin, UserManager.DISALLOW_ADD_USER);
            manager.addUserRestriction(admin, UserManager.DISALLOW_REMOVE_USER);
            return true;
        } catch (SecurityException | IllegalArgumentException ignored) {
            return false;
        }
    }

    public static boolean isFullyManaged(Context context) {
        if (!isDeviceOwner(context)) return false;
        DevicePolicyManager manager = dpm(context);
        try {
            String pkg = context.getPackageName();
            boolean uninstallBlocked = Build.VERSION.SDK_INT < Build.VERSION_CODES.P
                    || manager.isUninstallBlocked(admin(context), pkg);
            boolean lockTask = manager.isLockTaskPermitted(pkg);
            return uninstallBlocked && lockTask;
        } catch (SecurityException | IllegalArgumentException ignored) {
            return false;
        }
    }

    public static boolean isLockTaskActive(Context context) {
        Activity activity = context instanceof Activity ? (Activity) context : null;
        if (activity == null) return false;
        ActivityManagerState state = new ActivityManagerState(context);
        return state.isLockTaskActive();
    }

    public static boolean hasCallPermission(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || context.checkSelfPermission(Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED;
    }

    public static boolean isProvisioningReady(Context context) {
        return isDeviceOwner(context) && isLockTaskPermitted(context) && isFullyManaged(context);
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

    /** Small compatibility wrapper so callers don't need ActivityManager APIs. */
    private static final class ActivityManagerState {
        private final android.app.ActivityManager manager;
        ActivityManagerState(Context context) {
            manager = (android.app.ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        }
        boolean isLockTaskActive() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || manager == null) return false;
            return manager.getLockTaskModeState() == android.app.ActivityManager.LOCK_TASK_MODE_LOCKED;
        }
    }
}
