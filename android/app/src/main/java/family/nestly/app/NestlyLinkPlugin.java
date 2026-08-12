package family.nestly.app;

import android.Manifest;
import android.app.Activity;
import android.app.AppOpsManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.VpnService;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelUuid;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;

import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * The child device's half of the Nestly link.
 *
 * `@capacitor-community/bluetooth-le` only implements the BLE *central* role,
 * so it cannot make a phone discoverable. This plugin supplies the peripheral
 * side — advertiser plus GATT server — which is what lets one phone connect to
 * another rather than to a gadget.
 *
 * It also owns location sampling. Fixes are buffered natively rather than
 * pushed straight into JavaScript, because a backgrounded WebView has its
 * timers throttled hard: the JS agent would miss samples, and the child's
 * location history would quietly develop holes. Native collects, JS drains
 * whenever it next runs, and every fix keeps its own timestamp so the history
 * stays accurate regardless of when it was read.
 */
@CapacitorPlugin(
        name = "NestlyLink",
        permissions = {
                @Permission(alias = "location", strings = {
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION
                }),
                @Permission(alias = "btScan", strings = { "android.permission.BLUETOOTH_SCAN" }),
                @Permission(alias = "btConnect", strings = { "android.permission.BLUETOOTH_CONNECT" }),
                @Permission(alias = "btAdvertise", strings = { "android.permission.BLUETOOTH_ADVERTISE" }),
                @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }),
                @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS })
        }
)
public class NestlyLinkPlugin extends Plugin {

    // Must match src/link/protocol.ts.
    private static final UUID SERVICE_UUID = UUID.fromString("f1a70001-9c2b-4a55-8e7d-3b6c1d0e5a90");
    private static final UUID CHAR_UPLINK = UUID.fromString("f1a70002-9c2b-4a55-8e7d-3b6c1d0e5a90");
    private static final UUID CHAR_DOWNLINK = UUID.fromString("f1a70003-9c2b-4a55-8e7d-3b6c1d0e5a90");
    /** Standard Client Characteristic Configuration descriptor. */
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private static final int MAX_BUFFERED_FIXES = 2000;

    /**
     * 0xFFFF is the Bluetooth SIG's "reserved for internal/test use" company id.
     * Correct choice for an unregistered vendor; swap for a real assigned id if
     * Nestly ever registers one.
     */
    private static final int MANUFACTURER_ID = 0xFFFF;

    /** A scan response has 31 bytes total; the manufacturer-data header eats 4. */
    private static final int MAX_NAME_BYTES = 24;

    /** Separate from the agent's ongoing channel so each can be silenced alone. */
    private static final String REMINDER_CHANNEL = "nestly_reminders";

    private BluetoothManager btManager;
    private BluetoothGattServer gattServer;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothGattCharacteristic uplink;
    private AdvertiseCallback advertiseCallback;

    /** Devices that have subscribed to uplink notifications. */
    private final List<BluetoothDevice> subscribers = new ArrayList<>();

    private LocationManager locationManager;
    private LocationListener locationListener;
    private final Deque<JSObject> fixes = new ArrayDeque<>();

    private boolean running = false;

    /* ------------------------------------------------------------ support -- */

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject res = new JSObject();
        BluetoothAdapter adapter = adapter();
        boolean hasBle = getContext().getPackageManager()
                .hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE);
        boolean canAdvertise = adapter != null && adapter.isMultipleAdvertisementSupported();

        res.put("ble", hasBle);
        res.put("enabled", adapter != null && adapter.isEnabled());
        // Not every Android device can act as a peripheral. Reporting this up
        // front lets the UI say so plainly instead of failing at pairing time.
        res.put("peripheral", canAdvertise);
        call.resolve(res);
    }

    @PluginMethod
    public void ensurePermissions(PluginCall call) {
        List<String> needed = new ArrayList<>();
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) needed.add("location");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // The BLUETOOTH_* runtime permissions only exist from Android 12;
            // below that the manifest BLUETOOTH/BLUETOOTH_ADMIN grants suffice.
            if (!granted("android.permission.BLUETOOTH_CONNECT")) needed.add("btConnect");
            if (!granted("android.permission.BLUETOOTH_ADVERTISE")) needed.add("btAdvertise");
            if (!granted("android.permission.BLUETOOTH_SCAN")) needed.add("btScan");
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && !granted("android.permission.POST_NOTIFICATIONS")) {
            needed.add("notifications");
        }

        if (needed.isEmpty()) {
            call.resolve(permissionState());
            return;
        }
        requestPermissionForAliases(needed.toArray(new String[0]), call, "permissionsResult");
    }

    @PermissionCallback
    private void permissionsResult(PluginCall call) {
        call.resolve(permissionState());
    }

    private JSObject permissionState() {
        JSObject res = new JSObject();
        res.put("location", granted(Manifest.permission.ACCESS_FINE_LOCATION));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            res.put("bluetooth", granted("android.permission.BLUETOOTH_CONNECT")
                    && granted("android.permission.BLUETOOTH_ADVERTISE"));
        } else {
            res.put("bluetooth", true);
        }
        return res;
    }

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission)
                == PackageManager.PERMISSION_GRANTED;
    }

    private BluetoothAdapter adapter() {
        if (btManager == null) {
            btManager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        }
        return btManager == null ? null : btManager.getAdapter();
    }

    /* ------------------------------------------------------------- start -- */

    @PluginMethod
    public void start(PluginCall call) {
        String name = call.getString("name", "Nestly child");

        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth is off");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && (!granted("android.permission.BLUETOOTH_ADVERTISE")
                || !granted("android.permission.BLUETOOTH_CONNECT"))) {
            call.reject("Bluetooth permission not granted");
            return;
        }

        try {
            NestlyForegroundService.start(getContext(), "Looking after this phone.");
            openGattServer();
            startAdvertising(name);
            startLocation();
            running = true;
            emitState("advertising", null);
            call.resolve();
        } catch (SecurityException e) {
            call.reject("Missing Bluetooth permission: " + e.getMessage());
        } catch (Exception e) {
            call.reject("Could not start the link: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        teardown();
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject res = new JSObject();
        res.put("running", running);
        res.put("subscribers", subscribers.size());
        res.put("bufferedFixes", fixes.size());
        call.resolve(res);
    }

    /* --------------------------------------------------------------- gatt -- */

    private void openGattServer() throws SecurityException {
        if (gattServer != null) return;

        gattServer = btManager.openGattServer(getContext(), gattCallback);
        if (gattServer == null) throw new IllegalStateException("openGattServer returned null");

        BluetoothGattService service =
                new BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY);

        uplink = new BluetoothGattCharacteristic(
                CHAR_UPLINK,
                BluetoothGattCharacteristic.PROPERTY_NOTIFY | BluetoothGattCharacteristic.PROPERTY_READ,
                BluetoothGattCharacteristic.PERMISSION_READ
        );
        BluetoothGattDescriptor cccd = new BluetoothGattDescriptor(
                CCCD,
                BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE
        );
        uplink.addDescriptor(cccd);

        BluetoothGattCharacteristic downlink = new BluetoothGattCharacteristic(
                CHAR_DOWNLINK,
                BluetoothGattCharacteristic.PROPERTY_WRITE
                        | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
                BluetoothGattCharacteristic.PERMISSION_WRITE
        );

        service.addCharacteristic(uplink);
        service.addCharacteristic(downlink);
        gattServer.addService(service);
    }

    private final BluetoothGattServerCallback gattCallback = new BluetoothGattServerCallback() {
        @Override
        public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
            if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                subscribers.remove(device);
                emitState(subscribers.isEmpty() ? "advertising" : "connected", null);
            } else if (newState == BluetoothProfile.STATE_CONNECTED) {
                emitState("connecting", null);
            }
        }

        @Override
        public void onDescriptorWriteRequest(BluetoothDevice device, int requestId,
                                             BluetoothGattDescriptor descriptor,
                                             boolean preparedWrite, boolean responseNeeded,
                                             int offset, byte[] value) {
            // Subscribing to the CCCD is what turns a connection into a live
            // uplink; until then notifications go nowhere.
            if (CCCD.equals(descriptor.getUuid())) {
                boolean enable = value != null && value.length > 0 && value[0] != 0;
                if (enable) {
                    if (!subscribers.contains(device)) subscribers.add(device);
                    emitState("connected", device.getAddress());
                } else {
                    subscribers.remove(device);
                }
            }
            if (responseNeeded) {
                safeSendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
            }
        }

        @Override
        public void onCharacteristicWriteRequest(BluetoothDevice device, int requestId,
                                                 BluetoothGattCharacteristic characteristic,
                                                 boolean preparedWrite, boolean responseNeeded,
                                                 int offset, byte[] value) {
            if (CHAR_DOWNLINK.equals(characteristic.getUuid()) && value != null) {
                JSObject ev = new JSObject();
                ev.put("data", Base64.encodeToString(value, Base64.NO_WRAP));
                notifyListeners("rx", ev);
            }
            if (responseNeeded) {
                safeSendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
            }
        }

        @Override
        public void onCharacteristicReadRequest(BluetoothDevice device, int requestId, int offset,
                                                BluetoothGattCharacteristic characteristic) {
            safeSendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, new byte[0]);
        }
    };

    private void safeSendResponse(BluetoothDevice device, int requestId, int status, int offset,
                                  byte[] value) {
        try {
            if (gattServer != null) gattServer.sendResponse(device, requestId, status, offset, value);
        } catch (SecurityException ignored) {
            // Permission revoked mid-session; the link will drop on its own.
        }
    }

    /* -------------------------------------------------------------- send -- */

    @PluginMethod
    public void send(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("data is required");
            return;
        }
        if (gattServer == null || uplink == null) {
            call.reject("link is not running");
            return;
        }
        byte[] bytes = Base64.decode(data, Base64.NO_WRAP);

        int delivered = 0;
        try {
            for (BluetoothDevice device : new ArrayList<>(subscribers)) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    gattServer.notifyCharacteristicChanged(device, uplink, false, bytes);
                } else {
                    uplink.setValue(bytes);
                    gattServer.notifyCharacteristicChanged(device, uplink, false);
                }
                delivered++;
            }
        } catch (SecurityException e) {
            call.reject("Missing Bluetooth permission: " + e.getMessage());
            return;
        }

        JSObject res = new JSObject();
        res.put("delivered", delivered);
        call.resolve(res);
    }

    /* --------------------------------------------------------- advertising -- */

    private void startAdvertising(String name) throws SecurityException {
        advertiser = adapter().getBluetoothLeAdvertiser();
        if (advertiser == null) throw new IllegalStateException("BLE advertising unavailable");

        AdvertiseSettings settings = new AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
                .setConnectable(true)
                .setTimeout(0)
                .build();

        // The advertisement packet is only 31 bytes and the 128-bit service UUID
        // eats 18 of them, so identity goes in the scan response.
        AdvertiseData data = new AdvertiseData.Builder()
                .setIncludeDeviceName(false)
                .addServiceUuid(new ParcelUuid(SERVICE_UUID))
                .build();

        // NOT setIncludeDeviceName: that broadcasts the *phone's* Bluetooth name
        // ("Joe's A54"), not the child name chosen during setup — so the parent
        // ends up pairing with something it cannot name. Carrying the real name
        // as manufacturer data also gives the parent a stable key to
        // de-duplicate on, since the advertisement and the scan response can
        // surface as two separate scan results for the same phone.
        AdvertiseData scanResponse = new AdvertiseData.Builder()
                .setIncludeDeviceName(false)
                .addManufacturerData(MANUFACTURER_ID, encodeName(name))
                .build();

        advertiseCallback = new AdvertiseCallback() {
            @Override
            public void onStartSuccess(AdvertiseSettings settingsInEffect) {
                emitState("advertising", null);
            }

            @Override
            public void onStartFailure(int errorCode) {
                emitState("error", advertiseError(errorCode));
            }
        };
        advertiser.startAdvertising(settings, data, scanResponse, advertiseCallback);
    }

    /**
     * UTF-8 encodes the child name, truncated on a character boundary.
     *
     * Cutting the byte array blindly would split a multi-byte character and the
     * parent would decode a replacement glyph in the middle of a name.
     */
    private static byte[] encodeName(String name) {
        String trimmed = name == null ? "" : name.trim();
        byte[] bytes = trimmed.getBytes(StandardCharsets.UTF_8);
        while (bytes.length > MAX_NAME_BYTES && trimmed.length() > 0) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
            bytes = trimmed.getBytes(StandardCharsets.UTF_8);
        }
        return bytes;
    }

    private static String advertiseError(int code) {
        switch (code) {
            case AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE:
                return "Advertisement data too large";
            case AdvertiseCallback.ADVERTISE_FAILED_TOO_MANY_ADVERTISERS:
                return "Too many advertisers running";
            case AdvertiseCallback.ADVERTISE_FAILED_ALREADY_STARTED:
                return "Already advertising";
            case AdvertiseCallback.ADVERTISE_FAILED_INTERNAL_ERROR:
                return "Bluetooth internal error";
            case AdvertiseCallback.ADVERTISE_FAILED_FEATURE_UNSUPPORTED:
                return "This phone cannot act as a Bluetooth peripheral";
            default:
                return "Advertising failed (" + code + ")";
        }
    }

    /* ----------------------------------------------------------- location -- */

    private void startLocation() {
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) return;
        if (locationManager == null) {
            locationManager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        }
        if (locationManager == null || locationListener != null) return;

        locationListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                JSObject fix = new JSObject();
                fix.put("lat", location.getLatitude());
                fix.put("lng", location.getLongitude());
                fix.put("acc", location.getAccuracy());
                fix.put("ts", location.getTime());
                synchronized (fixes) {
                    // Bounded buffer: a child phone that goes weeks without
                    // seeing the parent must not grow this without limit.
                    if (fixes.size() >= MAX_BUFFERED_FIXES) fixes.removeFirst();
                    fixes.addLast(fix);
                }
            }

            @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
            @Override public void onProviderEnabled(String provider) {}
            @Override public void onProviderDisabled(String provider) {}
        };

        try {
            // 60s / 25m is a deliberate compromise: fine enough to catch a
            // geofence crossing, coarse enough not to flatten the battery of a
            // phone that has to last a school day.
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER, 60_000L, 25f, locationListener);
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER, 60_000L, 25f, locationListener);
            }
        } catch (SecurityException ignored) {
        }
    }

    /** Hands over buffered fixes and clears them. */
    @PluginMethod
    public void drainFixes(PluginCall call) {
        JSArray out = new JSArray();
        synchronized (fixes) {
            while (!fixes.isEmpty()) out.put(fixes.removeFirst());
        }
        JSObject res = new JSObject();
        res.put("fixes", out);
        call.resolve(res);
    }

    @PluginMethod
    public void getBattery(PluginCall call) {
        JSObject res = new JSObject();
        Intent status = getContext().registerReceiver(
                null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (status == null) {
            res.put("level", null);
            res.put("charging", null);
        } else {
            int level = status.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = status.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            int plugged = status.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
            res.put("level", level >= 0 && scale > 0 ? Math.round(level * 100f / scale) : null);
            res.put("charging", plugged != 0);
        }
        call.resolve(res);
    }

    /* ---------------------------------------------------------- contacts -- */

    /**
     * Reports contacts newly added to the child's phone.
     *
     * A new number appearing is one of the few early signals of a stranger
     * making contact, which is why parents ask for it. It is also a genuine
     * privacy escalation, so the design is deliberately narrow:
     *
     *   - only *additions* are reported, never the address book
     *   - only the display name travels, never the number
     *   - the child's "What's shared" screen lists this explicitly
     *
     * The first run seeds the baseline silently. Without that, enabling the
     * feature would fire one alert per existing contact — hundreds of them —
     * and the parent would turn the whole thing off.
     */
    @PluginMethod
    public void drainNewContacts(PluginCall call) {
        JSObject res = new JSObject();
        JSArray added = new JSArray();

        if (!granted(Manifest.permission.READ_CONTACTS)) {
            res.put("granted", false);
            res.put("added", added);
            call.resolve(res);
            return;
        }

        android.content.SharedPreferences prefs =
                getContext().getSharedPreferences("nestly_contacts", Context.MODE_PRIVATE);
        java.util.Set<String> seen =
                new java.util.HashSet<>(prefs.getStringSet("seen", new java.util.HashSet<>()));
        boolean firstRun = prefs.getBoolean("seeded", false) == false;

        java.util.Set<String> current = new java.util.HashSet<>();
        android.database.Cursor c = null;
        try {
            c = getContext().getContentResolver().query(
                    android.provider.ContactsContract.Contacts.CONTENT_URI,
                    new String[] {
                            android.provider.ContactsContract.Contacts._ID,
                            android.provider.ContactsContract.Contacts.DISPLAY_NAME,
                    },
                    null, null, null);
            if (c != null) {
                int idCol = c.getColumnIndex(android.provider.ContactsContract.Contacts._ID);
                int nameCol =
                        c.getColumnIndex(android.provider.ContactsContract.Contacts.DISPLAY_NAME);
                while (c.moveToNext()) {
                    String id = idCol >= 0 ? c.getString(idCol) : null;
                    if (id == null) continue;
                    current.add(id);
                    if (!firstRun && !seen.contains(id)) {
                        String name = nameCol >= 0 ? c.getString(nameCol) : null;
                        added.put(name == null || name.trim().isEmpty() ? "Unnamed contact" : name);
                    }
                }
            }
        } catch (SecurityException e) {
            res.put("granted", false);
            res.put("added", new JSArray());
            call.resolve(res);
            return;
        } finally {
            if (c != null) c.close();
        }

        // Store the full current set, so a deleted-then-readded contact is
        // reported again rather than being remembered forever.
        prefs.edit()
                .putStringSet("seen", current)
                .putBoolean("seeded", true)
                .apply();

        res.put("granted", true);
        res.put("added", added);
        call.resolve(res);
    }

    @PluginMethod
    public void requestContactsPermission(PluginCall call) {
        if (granted(Manifest.permission.READ_CONTACTS)) {
            JSObject res = new JSObject();
            res.put("granted", true);
            call.resolve(res);
            return;
        }
        requestPermissionForAliases(new String[] { "contacts" }, call, "contactsResult");
    }

    @PermissionCallback
    private void contactsResult(PluginCall call) {
        JSObject res = new JSObject();
        res.put("granted", granted(Manifest.permission.READ_CONTACTS));
        call.resolve(res);
    }

    /* --------------------------------------------------------- reminders -- */

    /**
     * Posts a reminder as a real Android notification.
     *
     * A banner inside the app would only be seen by a child who already has
     * Nestly open, which is not when a reminder matters. This uses its own
     * channel so a child can silence reminders without silencing the ongoing
     * agent notification, and vice versa.
     */
    @PluginMethod
    public void notify(PluginCall call) {
        String title = call.getString("title");
        if (title == null || title.trim().isEmpty()) {
            call.reject("title is required");
            return;
        }
        String body = call.getString("body", "");
        int id = call.getInt("id", 2000);

        NotificationManager nm = (NotificationManager)
                getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            call.reject("no notification manager");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && nm.getNotificationChannel(REMINDER_CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(
                    REMINDER_CHANNEL,
                    "Reminders",
                    // DEFAULT, not LOW: a reminder that arrives silently has
                    // failed at the only thing it was for.
                    NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription("Reminders set by your parent.");
            nm.createNotificationChannel(channel);
        }

        Intent open = new Intent(getContext(), MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(getContext(), id, open, flags);

        Notification n = new NotificationCompat.Builder(getContext(), REMINDER_CHANNEL)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build();

        try {
            nm.notify(id, n);
            call.resolve();
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS refused on Android 13+. Not fatal: the in-app
            // banner still shows if Nestly happens to be open.
            call.reject("Notification permission not granted");
        }
    }

    /* ------------------------------------------------------------ filter -- */

    /**
     * Whether the child has consented to the VPN.
     *
     * `VpnService.prepare` returns an Intent when consent is still needed. That
     * dialog is a system one and must be launched from an Activity, so the JS
     * layer asks first and only then triggers the prompt.
     */
    @PluginMethod
    public void filterStatus(PluginCall call) {
        JSObject res = new JSObject();
        res.put("consented", VpnService.prepare(getContext()) == null);
        res.put("running", NestlyFilterService.isRunning());
        call.resolve(res);
    }

    @PluginMethod
    public void requestFilterConsent(PluginCall call) {
        Intent prepare = VpnService.prepare(getContext());
        if (prepare == null) {
            JSObject res = new JSObject();
            res.put("consented", true);
            call.resolve(res);
            return;
        }
        // The result comes back through handleOnActivityResult below.
        startActivityForResult(call, prepare, "vpnConsentResult");
    }

    @ActivityCallback
    private void vpnConsentResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject res = new JSObject();
        res.put("consented", result.getResultCode() == Activity.RESULT_OK);
        call.resolve(res);
    }

    /** Applies the current rules and starts (or restarts) the DNS filter. */
    @PluginMethod
    public void startFilter(PluginCall call) {
        if (VpnService.prepare(getContext()) != null) {
            call.reject("VPN consent not granted");
            return;
        }
        NestlyFilterService.setRules(readRules(call));
        Intent intent = new Intent(getContext(), NestlyFilterService.class);
        intent.setAction(NestlyFilterService.ACTION_START);
        getContext().startService(intent);
        call.resolve();
    }

    /** Updates rules in place; a no-op restart if the service is not running. */
    @PluginMethod
    public void updateFilter(PluginCall call) {
        NestlyFilterService.setRules(readRules(call));
        call.resolve();
    }

    @PluginMethod
    public void stopFilter(PluginCall call) {
        Intent intent = new Intent(getContext(), NestlyFilterService.class);
        intent.setAction(NestlyFilterService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve();
    }

    private FilterRules readRules(PluginCall call) {
        FilterRules r = new FilterRules();
        r.adult = Boolean.TRUE.equals(call.getBoolean("adult", true));
        r.violence = Boolean.TRUE.equals(call.getBoolean("violence", true));
        r.gambling = Boolean.TRUE.equals(call.getBoolean("gambling", true));
        r.social = Boolean.TRUE.equals(call.getBoolean("social", false));

        JSArray custom = call.getArray("custom");
        if (custom != null) {
            try {
                for (Object o : custom.toList()) {
                    if (o != null) r.custom.add(String.valueOf(o).trim().toLowerCase(Locale.US));
                }
            } catch (Exception ignored) {
            }
        }
        JSArray warn = call.getArray("warn");
        if (warn != null) {
            try {
                for (Object o : warn.toList()) {
                    int c = FilterRules.categoryOf(String.valueOf(o));
                    if (c != FilterRules.NONE) r.warnOnly.add(c);
                }
            } catch (Exception ignored) {
            }
        }
        return r;
    }

    /** Hands over block/warn decisions and the visited-domain tally. */
    @PluginMethod
    public void drainFilterEvents(PluginCall call) {
        JSArray events = new JSArray();
        for (String[] d : NestlyFilterService.drainDecisions()) {
            JSObject o = new JSObject();
            o.put("kind", d[0]);
            o.put("domain", d[1]);
            o.put("category", d[2]);
            o.put("ts", Long.parseLong(d[3]));
            events.put(o);
        }

        JSArray visits = new JSArray();
        for (String[] v : NestlyFilterService.snapshotVisits()) {
            JSObject o = new JSObject();
            o.put("domain", v[0]);
            o.put("count", Integer.parseInt(v[1]));
            o.put("lastAt", Long.parseLong(v[2]));
            o.put("blocked", "1".equals(v[3]));
            o.put("category", v[4]);
            visits.put(o);
        }

        JSObject res = new JSObject();
        res.put("events", events);
        res.put("visits", visits);
        res.put("running", NestlyFilterService.isRunning());
        call.resolve(res);
    }

    /* ------------------------------------------------------------- usage -- */

    /**
     * PACKAGE_USAGE_STATS is a "special" permission: it cannot be requested with
     * a normal prompt, only granted by the user in Settings. So the app checks,
     * explains, and sends them there.
     */
    @PluginMethod
    public void hasUsageAccess(PluginCall call) {
        JSObject res = new JSObject();
        res.put("granted", usageAccessGranted());
        call.resolve(res);
    }

    private boolean usageAccessGranted() {
        try {
            AppOpsManager ops = (AppOpsManager) getContext().getSystemService(Context.APP_OPS_SERVICE);
            if (ops == null) return false;
            int mode;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                mode = ops.unsafeCheckOpNoThrow(
                        AppOpsManager.OPSTR_GET_USAGE_STATS,
                        android.os.Process.myUid(),
                        getContext().getPackageName());
            } else {
                mode = ops.checkOpNoThrow(
                        AppOpsManager.OPSTR_GET_USAGE_STATS,
                        android.os.Process.myUid(),
                        getContext().getPackageName());
            }
            return mode == AppOpsManager.MODE_ALLOWED;
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void openUsageSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /** Foreground time per app since local midnight. */
    @PluginMethod
    public void getUsageToday(PluginCall call) {
        JSObject res = new JSObject();
        res.put("granted", usageAccessGranted());

        JSArray apps = new JSArray();
        if (usageAccessGranted()) {
            try {
                Calendar midnight = Calendar.getInstance();
                midnight.set(Calendar.HOUR_OF_DAY, 0);
                midnight.set(Calendar.MINUTE, 0);
                midnight.set(Calendar.SECOND, 0);
                midnight.set(Calendar.MILLISECOND, 0);

                UsageStatsManager usm =
                        (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
                List<UsageStats> stats = usm.queryUsageStats(
                        UsageStatsManager.INTERVAL_DAILY,
                        midnight.getTimeInMillis(),
                        System.currentTimeMillis());

                PackageManager pm = getContext().getPackageManager();
                Map<String, Long> totals = new HashMap<>();
                if (stats != null) {
                    for (UsageStats s : stats) {
                        long ms = s.getTotalTimeInForeground();
                        if (ms < 60_000) continue; // under a minute is noise
                        Long prev = totals.get(s.getPackageName());
                        totals.put(s.getPackageName(), (prev == null ? 0 : prev) + ms);
                    }
                }

                for (Map.Entry<String, Long> e : totals.entrySet()) {
                    String pkg = e.getKey();
                    if (pkg.equals(getContext().getPackageName())) continue;
                    JSObject o = new JSObject();
                    o.put("pkg", pkg);
                    o.put("label", labelFor(pm, pkg));
                    o.put("minutes", (int) (e.getValue() / 60_000));
                    o.put("category", categoryFor(pm, pkg));
                    apps.put(o);
                }
            } catch (Exception e) {
                Log.w("NestlyUsage", "usage query failed", e);
            }
        }
        res.put("apps", apps);
        call.resolve(res);
    }

    private String labelFor(PackageManager pm, String pkg) {
        try {
            return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
        } catch (Exception e) {
            return pkg;
        }
    }

    /**
     * Buckets an app for reporting. Android's own category is used where the
     * developer declared one; a short name list covers the common social apps,
     * which are the ones parents actually ask about.
     */
    private String categoryFor(PackageManager pm, String pkg) {
        String p = pkg.toLowerCase(Locale.US);
        if (p.contains("instagram") || p.contains("tiktok") || p.contains("snapchat")
                || p.contains("facebook") || p.contains("twitter") || p.contains("whatsapp")
                || p.contains("discord") || p.contains("reddit") || p.contains("telegram")) {
            return "social";
        }
        try {
            ApplicationInfo info = pm.getApplicationInfo(pkg, 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                switch (info.category) {
                    case ApplicationInfo.CATEGORY_SOCIAL: return "social";
                    case ApplicationInfo.CATEGORY_GAME: return "games";
                    case ApplicationInfo.CATEGORY_VIDEO: return "video";
                    case ApplicationInfo.CATEGORY_PRODUCTIVITY: return "education";
                    default: break;
                }
            }
        } catch (Exception ignored) {
        }
        return "other";
    }

    /* ---------------------------------------------------------- teardown -- */

    private void teardown() {
        running = false;
        try {
            if (advertiser != null && advertiseCallback != null) {
                advertiser.stopAdvertising(advertiseCallback);
            }
        } catch (SecurityException ignored) {
        }
        advertiseCallback = null;
        advertiser = null;

        try {
            if (gattServer != null) gattServer.close();
        } catch (SecurityException ignored) {
        }
        gattServer = null;
        uplink = null;
        subscribers.clear();

        if (locationManager != null && locationListener != null) {
            try {
                locationManager.removeUpdates(locationListener);
            } catch (SecurityException ignored) {
            }
        }
        locationListener = null;

        NestlyForegroundService.stop(getContext());
        emitState("off", null);
    }

    @Override
    protected void handleOnDestroy() {
        teardown();
        super.handleOnDestroy();
    }

    /* ------------------------------------------------------------ lock */

    @PluginMethod
    public void canOverlay(PluginCall call) {
        JSObject out = new JSObject();
        out.put("allowed", NestlyLockOverlay.canDraw(getContext()));
        call.resolve(out);
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        getContext().startActivity(NestlyLockOverlay.permissionIntent(getContext()));
        call.resolve();
    }

    /**
     * Shows or hides the enforced lock.
     *
     * Contacts arrive as a flat name/number list so the emergency numbers stay
     * reachable from the overlay itself — a lock that could stop a child calling
     * for help would be a hazard wearing the costume of a safety feature.
     */
    @PluginMethod
    public void setLocked(PluginCall call) {
        boolean locked = Boolean.TRUE.equals(call.getBoolean("locked", false));
        if (!locked) {
            getActivity().runOnUiThread(NestlyLockOverlay::hide);
            call.resolve();
            return;
        }

        String title = call.getString("title", "Phone locked");
        String subtitle = call.getString("subtitle", "A routine is running.");
        java.util.List<String> flat = new java.util.ArrayList<>();
        JSArray arr = call.getArray("contacts");
        if (arr != null) {
            try {
                for (Object o : arr.toList()) flat.add(String.valueOf(o));
            } catch (Exception ignored) {
                /* malformed list; show the lock without call buttons */
            }
        }
        final java.util.List<String[]> contacts = NestlyLockOverlay.pairs(flat);

        getActivity().runOnUiThread(() -> {
            // Rebuilt rather than updated: the contact list or the routine name
            // may have changed since it went up.
            NestlyLockOverlay.hide();
            NestlyLockOverlay.show(getContext(), title, subtitle, contacts);
        });
        call.resolve();
    }

    private void emitState(String state, String detail) {
        JSObject ev = new JSObject();
        ev.put("state", state);
        if (detail != null) ev.put("detail", detail);
        notifyListeners("state", ev);
    }
}
