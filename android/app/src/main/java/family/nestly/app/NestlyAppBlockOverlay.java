package family.nestly.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * The per-app block screen: one app is stopped, not the phone.
 *
 * Unlike {@link NestlyLockOverlay} this carries no emergency-contacts
 * section — only the foreground app is blocked, so the dialler and every
 * other app remain reachable normally, and there is nothing here that should
 * stand between a child and help.
 */
final class NestlyAppBlockOverlay {

    private static WindowManager windowManager;
    private static View overlay;
    private static String shownForPkg;

    @SuppressLint("InflateParams")
    static void show(Context ctx, String pkg, String title, String subtitle) {
        if (!NestlyLockOverlay.canDraw(ctx)) return;
        if (overlay != null) {
            if (pkg.equals(shownForPkg)) return; // already showing for this app
            hide();
        }

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
        heading.setText(title);
        heading.setTextColor(Color.WHITE);
        heading.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        heading.setGravity(Gravity.CENTER);
        root.addView(heading);

        TextView sub = new TextView(ctx);
        sub.setText(subtitle);
        sub.setTextColor(Color.parseColor("#B9C3CC"));
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        sub.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(-2, -2);
        subLp.topMargin = dp(ctx, 8);
        root.addView(sub, subLp);

        Button home = new Button(ctx);
        home.setText("Back to Home");
        home.setAllCaps(false);
        home.setTextColor(Color.WHITE);
        home.setBackgroundColor(Color.parseColor("#147D77"));
        home.setOnClickListener(v -> goHome(ctx));
        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(dp(ctx, 220), -2);
        btnLp.topMargin = dp(ctx, 26);
        root.addView(home, btnLp);

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                -1, -1, type,
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.CENTER;

        try {
            windowManager.addView(root, lp);
            overlay = root;
            shownForPkg = pkg;
        } catch (Exception ignored) {
            overlay = null;
            shownForPkg = null;
        }
    }

    private static void goHome(Context ctx) {
        Intent home = new Intent(Intent.ACTION_MAIN);
        home.addCategory(Intent.CATEGORY_HOME);
        home.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(home);
    }

    static void hide() {
        if (overlay == null || windowManager == null) return;
        try {
            windowManager.removeView(overlay);
        } catch (Exception ignored) { }
        overlay = null;
        shownForPkg = null;
    }

    private static int dp(Context ctx, int value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, ctx.getResources().getDisplayMetrics()));
    }
}
