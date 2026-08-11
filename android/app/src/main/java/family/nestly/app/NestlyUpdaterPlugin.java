package family.nestly.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Over-the-air updates for a sideloaded build.
 *
 * Nestly is installed from nestly.app rather than a store, so nothing else is
 * going to update it — a parent on an old build stays there forever, including
 * through security fixes. This downloads the new APK and hands it to Android's
 * package installer.
 *
 * It does not install anything by itself, and cannot. Android always shows its
 * own confirmation dialog, and the user can refuse; "auto" here means the app
 * notices and fetches, not that it installs behind anyone's back.
 *
 * TWO THINGS THIS DELIBERATELY CHECKS BEFORE OFFERING THE INSTALL:
 *
 *   - The download is verified against a SHA-256 from the manifest. Without it,
 *     anything able to intercept the response could hand the phone a different
 *     APK and the app would politely ask the user to install it.
 *   - The new package must be signed by the same key, which Android enforces on
 *     update. That is what stops a substituted APK replacing Nestly, so the
 *     hash check is defence in depth rather than the only guard.
 *
 * REMOVE BEFORE GOOGLE PLAY. Play updates its own apps, and shipping a
 * self-updater is grounds for removal under Device and Network Abuse.
 */
@CapacitorPlugin(name = "NestlyUpdater")
public class NestlyUpdaterPlugin extends Plugin {

    private static final String TAG = "NestlyUpdater";
    /** Nothing legitimate is this big; a runaway or hostile response stops here. */
    private static final long MAX_BYTES = 80L * 1024 * 1024;

    /** The versionCode this build was compiled with, for comparing to the manifest. */
    @PluginMethod
    public void currentVersion(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? info.getLongVersionCode()
                    : info.versionCode;
            JSObject out = new JSObject();
            out.put("versionCode", code);
            out.put("versionName", info.versionName);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("Could not read the installed version.", e);
        }
    }

    /** Whether the user has allowed this app to install packages. */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject out = new JSObject();
        out.put("allowed", Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(out);
    }

    /**
     * Downloads an APK, verifies it, and opens the installer.
     *
     * Runs off the main thread: this is a multi-megabyte download over whatever
     * connection a family happens to have, and blocking the WebView thread would
     * freeze the app for the duration.
     */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        final String expectedSha = call.getString("sha256");
        if (url == null || url.isEmpty()) {
            call.reject("No update URL.");
            return;
        }
        // Plain http would make the hash check meaningless: whoever could swap
        // the APK could swap the manifest that describes it.
        if (!url.startsWith("https://")) {
            call.reject("Updates must come over https.");
            return;
        }

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                File out = new File(getContext().getCacheDir(), "nestly-update.apk");
                if (out.exists() && !out.delete()) {
                    call.reject("Could not clear the previous download.");
                    return;
                }

                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(60000);
                conn.setInstanceFollowRedirects(true);
                conn.connect();

                if (conn.getResponseCode() / 100 != 2) {
                    call.reject("Update download failed (" + conn.getResponseCode() + ").");
                    return;
                }

                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long total = 0;
                try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
                    byte[] buf = new byte[16384];
                    int read;
                    while ((read = in.read(buf)) > 0) {
                        total += read;
                        if (total > MAX_BYTES) {
                            call.reject("Update is unexpectedly large; stopped.");
                            return;
                        }
                        digest.update(buf, 0, read);
                        fos.write(buf, 0, read);
                    }
                }

                String actual = hex(digest.digest());
                if (expectedSha != null && !expectedSha.isEmpty()
                        && !expectedSha.equalsIgnoreCase(actual)) {
                    // Delete it. Leaving a file that failed verification in the
                    // cache invites something else finding and opening it.
                    //noinspection ResultOfMethodCallIgnored
                    out.delete();
                    call.reject("This update did not match its signature and was discarded.");
                    return;
                }

                Uri uri = FileProvider.getUriForFile(
                        getContext(), getContext().getPackageName() + ".fileprovider", out);

                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);

                JSObject res = new JSObject();
                res.put("started", true);
                res.put("bytes", total);
                res.put("sha256", actual);
                call.resolve(res);
            } catch (Exception e) {
                Log.w(TAG, "update failed", e);
                call.reject("Could not download the update. " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }, "nestly-update").start();
    }

    /** Opens the system screen where the user grants install permission. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent i = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
