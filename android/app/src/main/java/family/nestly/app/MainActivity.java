package family.nestly.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1002;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NestlyLinkPlugin.class);
        registerPlugin(NestlySafetyLockPlugin.class);
        super.onCreate(savedInstanceState);

        if (getBridge() != null) {
            getBridge().registerPlugin(NestlyUpdaterPlugin.class);
        }

        // The child command transport is native so remote lock does not depend
        // on a WebView timer or the app being visible. The service is harmless
        // on a parent install because it exits when no child enrolment exists.
        NestlyCommandService.start(this);
        requestNotificationPermissionIfNeeded();
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) return;

        ActivityCompat.requestPermissions(
                this,
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                NOTIFICATION_PERMISSION_REQUEST
        );
    }

    @Override
    public void onResume() {
        super.onResume();
        // A Device Owner child app is expected to remain the foreground safety
        // surface. The JS agent controls when the lock is entered; the native
        // command service handles remote lock while the UI is closed.
    }
}
