package family.nestly.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NestlyLinkPlugin.class);
        registerPlugin(NestlySafetyLockPlugin.class);
        super.onCreate(savedInstanceState);

        if (getBridge() != null) {
            getBridge().registerPlugin(NestlyUpdaterPlugin.class);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // A Device Owner child app is expected to remain the foreground safety
        // surface. The JS agent controls when the lock is entered; this avoids
        // silently forcing kiosk mode during normal onboarding.
    }
}
