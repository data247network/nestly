package family.nestly.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.PluginMethod;

/** Capacitor bridge for child-device safety locking and Device Owner status. */
@CapacitorPlugin(name = "NestlySafetyLock")
public class NestlySafetyLockPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("deviceOwner", NestlyDeviceOwner.isDeviceOwner(getContext()));
        result.put("lockTaskPermitted", NestlyDeviceOwner.isLockTaskPermitted(getContext()));
        result.put("legacyAdmin", NestlyDeviceAdmin.isActive(getContext()));
        result.put("canLock", NestlyDeviceOwner.isLockTaskPermitted(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        boolean configured = NestlyDeviceOwner.configure(getContext());
        JSObject result = new JSObject();
        result.put("configured", configured);
        result.put("deviceOwner", NestlyDeviceOwner.isDeviceOwner(getContext()));
        result.put("lockTaskPermitted", NestlyDeviceOwner.isLockTaskPermitted(getContext()));
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
        intent.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
