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
    private static final String CAP_STORE = "CapacitorStorage";
    private static final String KEY_ENROLMENT = "nestly.enrolment";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NestlyLinkPlugin.class);
        registerPlugin(NestlySafetyLockPlugin.class);
        super.onCreate(savedInstanceState);

        if (getBridge() != null) {
            getBridge().registerPlugin(NestlyUpdaterPlugin.class);
        }

        startChildCommandServiceIfEnrolled();
        requestNotificationPermissionIfNeeded();
    }

    @Override
    public void onResume() {
        super.onResume();
        startChildCommandServiceIfEnrolled();
    }

    /**
     * Starts the native command agent only when this installation has a
     * completed child enrolment record. Parent installations do not have this
     * record and therefore never start the foreground command service.
     */
    private void startChildCommandServiceIfEnrolled() {
        String raw = getSharedPreferences(CAP_STORE, MODE_PRIVATE)
                .getString(KEY_ENROLMENT, null);
        if (raw == null || raw.isEmpty()) return;

        try {
            org.json.JSONObject enrolment = new org.json.JSONObject(raw);
            String childId = enrolment.optString("childId", "");
            String deviceSecret = enrolment.optString("deviceSecret", "");
            if (!childId.isEmpty() && !deviceSecret.isEmpty()) {
                NestlyCommandService.start(this);
            }
        } catch (org.json.JSONException ignored) {
            // Invalid/partial enrolment data must never crash app startup.
        }
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
