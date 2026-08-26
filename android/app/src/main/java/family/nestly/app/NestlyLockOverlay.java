package family.nestly.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.telecom.TelecomManager;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/**
 * The lock, actually enforced.
 *
 * Parent-configured safety contacts remain callable while any child lock is
 * active. Calls are placed through Android Telecom directly rather than opening
 * the dialler, so School Lock does not have to permit the Phone application.
 */
public class NestlyLockOverlay {

    private static WindowManager windowManager;
    private static View overlay;

    public static boolean canDraw(Context ctx) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx);
    }

    public static boolean isShowing() {
        return overlay != null;
    }

    @SuppressLint("InflateParams")
    public static void show(Context ctx, String title, String subtitle, List<String[]> contacts) {
        if (!canDraw(ctx) || overlay != null) return;

        windowManager = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
        if (windowManager == null) return;

        LinearLayout root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#F2141F26"));
        int pad = dp(ctx, 28);
        root.setPadding(pad, pad, pad, pad);
        root.setClickable(true);
        root.setFocusable(true);

        TextView heading = new TextView(ctx);
        heading.setText(title == null ? "Phone locked" : title);
        heading.setTextColor(Color.WHITE);
        heading.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        heading.setGravity(Gravity.CENTER);
        root.addView(heading);

        TextView sub = new TextView(ctx);
        sub.setText(subtitle == null ? "A routine is running." : subtitle);
        sub.setTextColor(Color.parseColor("#B9C3CC"));
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        sub.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(-2, -2);
        subLp.topMargin = dp(ctx, 10);
        root.addView(sub, subLp);

        if (contacts != null && !contacts.isEmpty()) {
            TextView label = new TextView(ctx);
            label.setText("You can still call");
            label.setTextColor(Color.parseColor("#8A97A2"));
            label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            label.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams labelLp = new LinearLayout.LayoutParams(-2, -2);
            labelLp.topMargin = dp(ctx, 26);
            root.addView(label, labelLp);

            for (String[] c : contacts) {
                if (c == null || c.length < 2 || c[1] == null || c[1].trim().isEmpty()) continue;
                Button call = new Button(ctx);
                call.setText(c[0] == null || c[0].trim().isEmpty() ? c[1] : c[0]);
                call.setAllCaps(false);
                call.setTextColor(Color.WHITE);
                call.setBackgroundColor(Color.parseColor("#147D77"));
                final String number = c[1].trim();
                call.setOnClickListener(v -> placeParentCall(ctx, number));
                LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(dp(ctx, 240), -2);
                btnLp.topMargin = dp(ctx, 10);
                root.addView(call, btnLp);
            }
        }

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                -1, -1, type,
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.CENTER;

        try {
            windowManager.addView(root, lp);
            overlay = root;
        } catch (Exception ignored) {
            overlay = null;
        }
    }

    private static void placeParentCall(Context ctx, String number) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        if (ctx.checkSelfPermission(android.Manifest.permission.CALL_PHONE)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) return;

        TelecomManager telecom = (TelecomManager) ctx.getSystemService(Context.TELECOM_SERVICE);
        if (telecom == null) return;

        try {
            Uri address = Uri.fromParts("tel", number, null);
            Bundle extras = new Bundle();
            telecom.placeCall(address, extras);
        } catch (SecurityException ignored) {
            // Device Owner configuration grants CALL_PHONE to Nestly. If policy
            // or the SIM prevents the call, remain on the lock rather than crash.
        }
    }

    public static void hide() {
        if (overlay == null || windowManager == null) return;
        try {
            windowManager.removeView(overlay);
        } catch (Exception ignored) { }
        overlay = null;
    }

    public static List<String[]> pairs(List<String> flat) {
        List<String[]> out = new ArrayList<>();
        if (flat == null) return out;
        for (int i = 0; i + 1 < flat.size(); i += 2) {
            out.add(new String[] { flat.get(i), flat.get(i + 1) });
        }
        return out;
    }

    private static int dp(Context ctx, int value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, ctx.getResources().getDisplayMetrics()));
    }
}
