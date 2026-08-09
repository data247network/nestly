package family.nestly.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The child device's BLE peripheral role has no community plugin, so
        // it is registered here before the bridge starts.
        registerPlugin(NestlyLinkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
