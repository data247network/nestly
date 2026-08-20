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
import java.util.Locale;

/** Safe in-app updater for the sideloaded Nestly Android build. */
@CapacitorPlugin(name = "NestlyUpdater")
public class NestlyUpdaterPlugin extends Plugin {

    private static final String TAG = "NestlyUpdater";
    private static final long MAX_BYTES = 80L * 1024 * 1024;
    private static final String OFFICIAL_HOST = "nestly-gamma-seven.vercel.app";
    private static final String OFFICIAL_PATH = "/downloads/nestly.apk";

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

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject out = new JSObject();
        out.put("allowed", Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(out);
    }

    /** Downloads only from the official host, verifies the manifest hash and opens Android's installer. */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        final String expectedSha = call.getString("sha256");
        final Integer expectedSize = call.getInt("size");

        if (!isOfficialApkUrl(url)) {
            call.reject("Update URL is not an official Nestly download.");
            return;
        }
        if (expectedSha == null || !expectedSha.matches("(?i)^[a-f0-9]{64}$")) {
            call.reject("Update checksum is invalid.");
            return;
        }
        if (expectedSize != null && (expectedSize <= 0 || expectedSize > MAX_BYTES)) {
            call.reject("Update size is invalid.");
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
                conn.setInstanceFollowRedirects(false);
                conn.setRequestProperty("Accept", "application/vnd.android.package-archive");
                conn.connect();

                int code = conn.getResponseCode();
                if (code != HttpURLConnection.HTTP_OK) {
                    call.reject("Update download failed (" + code + ").");
                    return;
                }

                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long total = 0;
                try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
                    byte[] buf = new byte[16384];
                    int read;
                    while ((read = in.read(buf)) > 0) {
                        total += read;
                        if (total > MAX_BYTES || (expectedSize != null && total > expectedSize)) {
                            //noinspection ResultOfMethodCallIgnored
                            out.delete();
                            call.reject("Update is unexpectedly large; stopped.");
                            return;
                        }
                        digest.update(buf, 0, read);
                        fos.write(buf, 0, read);
                    }
                }

                if (expectedSize != null && total != expectedSize) {
                    //noinspection ResultOfMethodCallIgnored
                    out.delete();
                    call.reject("Update size did not match the published release.");
                    return;
                }

                String actual = hex(digest.digest());
                if (!expectedSha.equalsIgnoreCase(actual)) {
                    //noinspection ResultOfMethodCallIgnored
                    out.delete();
                    call.reject("Update checksum did not match the published release.");
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

    private static boolean isOfficialApkUrl(String value) {
        if (value == null || value.isEmpty()) return false;
        try {
            URL u = new URL(value);
            return "https".equalsIgnoreCase(u.getProtocol())
                    && OFFICIAL_HOST.equalsIgnoreCase(u.getHost())
                    && OFFICIAL_PATH.equals(u.getPath())
                    && (u.getQuery() == null || u.getQuery().isEmpty())
                    && (u.getRef() == null || u.getRef().isEmpty());
        } catch (Exception ignored) {
            return false;
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format(Locale.ROOT, "%02x", b));
        return sb.toString();
    }
}
