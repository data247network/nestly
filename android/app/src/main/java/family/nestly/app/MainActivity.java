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

        // Do not start the child-only command agent on every Nestly install.
        // Parent devices have no child enrolment and should never create the
        // remote-messaging foreground service. A child starts it once its local
        // enrolment record exists; onResume also covers completion of setup.
        NestlyCommandService.startIfEnrolled(this);
        requestNotificationPermissionIfNeeded();
    }

    @Override
    public void onResume() {
        super.onResume();
        // Re-check after setup/pairing screens return to the main Activity.
        NestlyCommandService.startIfEnrolled(this);
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
}
