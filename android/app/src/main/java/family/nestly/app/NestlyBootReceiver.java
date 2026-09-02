package family.nestly.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Reasserts the Device Owner policy after a completed Android boot. */
public class NestlyBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        if (NestlyDeviceOwner.isDeviceOwner(context)) {
            NestlyDeviceOwner.configure(context);
        }
    }
}
