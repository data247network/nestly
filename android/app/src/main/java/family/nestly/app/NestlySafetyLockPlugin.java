package family.nestly.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.telecom.TelecomManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Capacitor bridge for child-device safety locking and Device Owner status. */
@CapacitorPlugin(name = "NestlySafetyLock")
public class NestlySafetyLockPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("deviceOwner", NestlyDeviceOwner.isDeviceOwner(context));
        result.put("fullyManaged", NestlyDeviceOwner.isFullyManaged(context));
        result.put("lockTaskPermitted", NestlyDeviceOwner.isLockTaskPermitted(context));
        result.put("lockTaskActive", NestlyDeviceOwner.isLockTaskActive(context));
        result.put("legacyAdmin", NestlyDeviceAdmin.isActive(context));
        result.put("callPermission", NestlyDeviceOwner.hasCallPermission(context));
        result.put("canLock", NestlyDeviceOwner.isLockTaskPermitted(context));

        SharedPreferences prefs = context.getSharedPreferences(
                NestlyDeviceAdmin.PREFS, Context.MODE_PRIVATE);
        result.put("adminDisabledAt", prefs.getLong(NestlyDeviceAdmin.KEY_ADMIN_OFF_AT, 0L));
        result.put("deviceOwnerConfiguredAt", prefs.getLong(
                NestlyDeviceAdmin.KEY_DEVICE_OWNER_CONFIGURED_AT, 0L));
        call.resolve(result);
    }

    @PluginMethod
    public void clearTamper(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(
                NestlyDeviceAdmin.PREFS, Context.MODE_PRIVATE);
        prefs.edit().remove(NestlyDeviceAdmin.KEY_ADMIN_OFF_AT).apply();
        call.resolve();
    }

    @PluginMethod
    public void configure(PluginCall call) {
        boolean configured = NestlyDeviceOwner.configure(getContext());
        JSObject result = new JSObject();
        result.put("configured", configured);
        result.put("deviceOwner", NestlyDeviceOwner.isDeviceOwner(getContext()));
        result.put("fullyManaged", NestlyDeviceOwner.isFullyManaged(getContext()));
        result.put("lockTaskPermitted", NestlyDeviceOwner.isLockTaskPermitted(getContext()));
        result.put("callPermission", NestlyDeviceOwner.hasCallPermission(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void lock(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity unavailable");
            return;
        }
        boolean locked = NestlyDeviceOwner.lock(activity);
        JSObject result = new JSObject();
        result.put("locked", locked);
        result.put("deviceOwner", NestlyDeviceOwner.isDeviceOwner(getContext()));
        result.put("fullyManaged", NestlyDeviceOwner.isFullyManaged(getContext()));
        result.put("lockTaskPermitted", NestlyDeviceOwner.isLockTaskPermitted(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity unavailable");
            return;
        }
        call.resolve(new JSObject().put("unlocked", NestlyDeviceOwner.unlock(activity)));
    }

    /**
     * Place a parent-configured safety call without opening the dialler. This
     * keeps School Lock in LockTask while Android Telecom handles the call.
     */
    @PluginMethod
    public void callSafetyContact(PluginCall call) {
        String number = call.getString("number", "").trim();
        if (number.isEmpty()) {
            call.reject("A safety contact number is required");
            return;
        }
        if (!NestlyDeviceOwner.isDeviceOwner(getContext())) {
            call.reject("Safety calling requires a managed Device Owner device");
            return;
        }
        if (!NestlyDeviceOwner.hasCallPermission(getContext())) {
            call.reject("CALL_PHONE permission is not granted by device policy");
            return;
        }
        try {
            TelecomManager telecom = (TelecomManager) getContext().getSystemService(Context.TELECOM_SERVICE);
            if (telecom == null) {
                call.reject("Telecom service unavailable");
                return;
            }
            Uri address = Uri.fromParts("tel", number, null);
            Bundle extras = new Bundle();
            telecom.placeCall(address, extras);
            call.resolve(new JSObject().put("started", true));
        } catch (SecurityException e) {
            call.reject("Android denied the safety call", e);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid safety contact number", e);
        }
    }

    @PluginMethod
    public void openDeviceOwnerHelp(PluginCall call) {
        Intent intent = NestlyDeviceOwner.provisioningHelpIntent();
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openAppDetails(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
