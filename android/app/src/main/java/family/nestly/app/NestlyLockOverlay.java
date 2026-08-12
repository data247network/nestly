package family.nestly.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
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
 * The lock used to be a screen inside the app, which meant it stopped anything
 * only for as long as the child chose to look at it: Home, and the phone was
 * theirs again. This draws over every other app instead, so a routine that says
 * "no phone at bedtime" means it.
 *
 * WHAT THIS IS NOT. It is an overlay, not a device lock. A determined teenager
 * can revoke the "display over other apps" permission in Settings, or uninstall
 * the app. Short of Device Owner provisioning — which requires a factory reset
 * and is not something a family will do — that is the ceiling on Android, and
 * the product should say so rather than imply a cage. Revoking it is visible to
 * the parent, which is the honest defence: this is a speed bump with a witness,
 * not a prison.
 *
 * EMERGENCY CALLS ARE ALWAYS AVAILABLE. A lock that could stop a child phoning
 * a parent or the emergency services would be a safety hazard dressed as a
 * safety feature, so the contacts the parent configured are on the overlay
 * itself and dial straight out.
 */
public class NestlyLockOverlay {

    private static WindowManager windowManager;
    private static View overlay;

    /** Whether the user has granted "display over other apps". */
    public static boolean canDraw(Context ctx) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx);
    }

    public static Intent permissionIntent(Context ctx) {
        Intent i = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + ctx.getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return i;
    }

    public static boolean isShowing() {
        return overlay != null;
    }

    /**
     * Puts the lock on screen.
     *
     * @param contacts alternating name/number pairs; may be empty.
     */
    @SuppressLint("InflateParams")
    public static void show(Context ctx, String title, String subtitle, List<String[]> contacts) {
        if (!canDraw(ctx)) return;
        if (overlay != null) return;

        windowManager = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
        if (windowManager == null) return;

        LinearLayout root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#F2141F26"));
        int pad = dp(ctx, 28);
        root.setPadding(pad, pad, pad, pad);
        // Swallows taps so they cannot reach whatever is behind the overlay.
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
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        subLp.topMargin = dp(ctx, 10);
        root.addView(sub, subLp);

        if (contacts != null && !contacts.isEmpty()) {
            TextView label = new TextView(ctx);
            label.setText("You can still call");
            label.setTextColor(Color.parseColor("#8A97A2"));
            label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            label.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams labelLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            labelLp.topMargin = dp(ctx, 26);
            root.addView(label, labelLp);

            for (String[] c : contacts) {
                if (c == null || c.length < 2 || c[1] == null || c[1].trim().isEmpty()) continue;
                Button call = new Button(ctx);
                call.setText(c[0] == null || c[0].trim().isEmpty() ? c[1] : c[0]);
                call.setAllCaps(false);
                call.setTextColor(Color.WHITE);
                call.setBackgroundColor(Color.parseColor("#147D77"));
                final String number = c[1];
                call.setOnClickListener(v -> {
                    // ACTION_DIAL, not ACTION_CALL: it opens the dialer with the
                    // number filled in and needs no calling permission, so this
                    // cannot fail shut at the moment a child needs it most.
                    Intent dial = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + number));
                    dial.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(dial);
                });
                LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(
                        dp(ctx, 240), LinearLayout.LayoutParams.WRAP_CONTENT);
                btnLp.topMargin = dp(ctx, 10);
                root.addView(call, btnLp);
            }
        }

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;

        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                type,
                // Not FLAG_NOT_TOUCHABLE: the whole point is to absorb touches.
                // FLAG_SHOW_WHEN_LOCKED keeps the emergency numbers reachable
                // without unlocking the phone first.
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.CENTER;

        try {
            windowManager.addView(root, lp);
            overlay = root;
        } catch (Exception e) {
            // Permission revoked between the check and the add, or an OEM that
            // refuses the window type. Failing silently is right: the app must
            // not crash on a child's phone over a lock screen.
            overlay = null;
        }
    }

    public static void hide() {
        if (overlay == null || windowManager == null) return;
        try {
            windowManager.removeView(overlay);
        } catch (Exception ignored) {
            /* already gone */
        }
        overlay = null;
    }

    /** Convenience for building the contact list from the JS side. */
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
