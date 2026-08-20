package family.nestly.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The child device's BLE peripheral role has no community plugin, so
        // it must be registered before the Capacitor bridge is created.
        registerPlugin(NestlyLinkPlugin.class);
        super.onCreate(savedInstanceState);

        // The updater is deliberately registered only after the bridge and
        // WebView have started. A failed updater must never prevent Nestly's
        // primary UI from loading. The JS side waits until after first paint
        // before calling this plugin.
        if (getBridge() != null) {
            getBridge().registerPlugin(NestlyUpdaterPlugin.class);
        }
    }
}
