package family.nestly.app;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.VpnService;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * DNS-level web filtering for the child device.
 *
 * WHY A VPN. An ordinary Android app cannot see or block what happens inside
 * Chrome or any other app. The only supported way to filter browsing without
 * root is to become the network path, and the lightest form of that is a local
 * VpnService that captures DNS. This is the same mechanism every mainstream
 * parental-control and ad-blocking app uses.
 *
 * WHAT IT DOES. The tunnel is configured so that *only* traffic to our fake DNS
 * server is routed into it — not the child's whole internet. We read each DNS
 * query, decide, and either answer NXDOMAIN (blocked) or forward it to a real
 * resolver and relay the reply. Everything else on the device is untouched,
 * which keeps battery and breakage low and means we never see message content.
 *
 * HONEST LIMITS, which the parent is told about in the app:
 *   - Chrome's "Secure DNS" (DNS-over-HTTPS) bypasses system DNS entirely.
 *   - A domain typed as a raw IP address is not a DNS lookup.
 *   - Without Device Owner enrolment the child can switch the VPN off; that is
 *     why doing so raises a `filter-off` event to the parent rather than
 *     failing quietly.
 *   - It sees domain names only. Never page content, never anything encrypted.
 */
public class NestlyFilterService extends VpnService implements Runnable {

    private static final String TAG = "NestlyFilter";

    // Addresses inside the tunnel. Chosen from a range unlikely to collide with
    // a home network.
    private static final String TUN_ADDRESS = "10.111.222.1";
    private static final String TUN_DNS = "10.111.222.2";
    private static final String UPSTREAM_DNS = "1.1.1.1";

    public static final String ACTION_START = "family.nestly.app.FILTER_START";
    public static final String ACTION_STOP = "family.nestly.app.FILTER_STOP";
    public static final String EXTRA_RULES = "rules";

    /** Set by the plugin; read by the packet loop. */
    private static volatile FilterRules rules = new FilterRules();
    private static volatile boolean running = false;

    /**
     * Decisions waiting to be handed to JavaScript. A bounded queue drained by
     * the plugin — the packet loop must never block on the bridge.
     */
    private static final ConcurrentLinkedQueue<String[]> decisions = new ConcurrentLinkedQueue<>();
    private static final int MAX_DECISIONS = 500;

    /** domain -> [count, lastSeenMs, blocked] for the visit report. */
    private static final Map<String, long[]> tally = new LinkedHashMap<>();
    private static final int MAX_TALLY = 400;

    private ParcelFileDescriptor tunnel;
    private Thread worker;

    public static boolean isRunning() {
        return running;
    }

    public static void setRules(FilterRules next) {
        rules = next == null ? new FilterRules() : next;
    }

    /** Hands over pending block/warn decisions and clears them. */
    public static List<String[]> drainDecisions() {
        List<String[]> out = new ArrayList<>();
        String[] item;
        while ((item = decisions.poll()) != null) out.add(item);
        return out;
    }

    /** Snapshot of the visit tally: {domain, count, lastAt, blocked, category}. */
    public static List<String[]> snapshotVisits() {
        List<String[]> out = new ArrayList<>();
        synchronized (tally) {
            for (Map.Entry<String, long[]> e : tally.entrySet()) {
                long[] v = e.getValue();
                out.add(new String[] {
                        e.getKey(),
                        String.valueOf(v[0]),
                        String.valueOf(v[1]),
                        v[2] == 1 ? "1" : "0",
                        v[3] == 0 ? "" : FilterRules.categoryName((int) v[3])
                });
            }
        }
        return out;
    }

    public static void clearVisits() {
        synchronized (tally) {
            tally.clear();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            teardown();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (running) return START_STICKY;

        try {
            Builder builder = new Builder()
                    .setSession("Nestly filtering")
                    .addAddress(TUN_ADDRESS, 32)
                    .addDnsServer(TUN_DNS)
                    // Route ONLY the fake resolver into the tunnel. Routing
                    // everything would make us responsible for the child's
                    // entire connection, which is far more to get wrong.
                    .addRoute(TUN_DNS, 32);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                builder.setMetered(false);
            }

            Intent configure = new Intent(this, MainActivity.class);
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) piFlags |= PendingIntent.FLAG_IMMUTABLE;
            builder.setConfigureIntent(PendingIntent.getActivity(this, 0, configure, piFlags));

            tunnel = builder.establish();
            if (tunnel == null) {
                Log.w(TAG, "establish() returned null — VPN consent missing?");
                stopSelf();
                return START_NOT_STICKY;
            }

            running = true;
            worker = new Thread(this, "nestly-dns");
            worker.start();
        } catch (Exception e) {
            Log.e(TAG, "could not start filter", e);
            teardown();
            stopSelf();
        }
        return START_STICKY;
    }

    @Override
    public void run() {
        try (
                FileInputStream in = new FileInputStream(tunnel.getFileDescriptor());
                FileOutputStream out = new FileOutputStream(tunnel.getFileDescriptor());
                DatagramSocket upstream = new DatagramSocket()
        ) {
            // Without protect() our own resolver traffic would be routed back
            // into the tunnel and loop forever.
            protect(upstream);
            upstream.setSoTimeout(4000);

            byte[] buffer = new byte[32767];
            while (running) {
                int length = in.read(buffer);
                if (length <= 0) {
                    Thread.sleep(10);
                    continue;
                }
                try {
                    handlePacket(buffer, length, out, upstream);
                } catch (Exception e) {
                    // One malformed packet must never kill filtering.
                    Log.w(TAG, "packet dropped: " + e.getMessage());
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "dns loop ended", e);
        } finally {
            running = false;
        }
    }

    private void handlePacket(byte[] packet, int length, FileOutputStream out, DatagramSocket upstream)
            throws Exception {
        // IPv4 only. IPv6 DNS is not routed into this tunnel, so it simply is
        // not seen — a stated limitation rather than a silent one.
        if (length < 28 || (packet[0] & 0xF0) != 0x40) return;

        int ihl = (packet[0] & 0x0F) * 4;
        int protocol = packet[9] & 0xFF;
        if (protocol != 17) return; // UDP only

        int udpStart = ihl;
        int dnsStart = udpStart + 8;
        if (dnsStart >= length) return;

        int dnsLength = length - dnsStart;
        byte[] query = new byte[dnsLength];
        System.arraycopy(packet, dnsStart, query, 0, dnsLength);

        String domain = Dns.readQuestionName(query);
        int matched = domain == null ? 0 : rules.match(domain);
        boolean block = matched != 0 && !rules.isWarnOnly(matched);

        if (domain != null) {
            record(domain, block, matched);
            if (matched != 0) {
                if (decisions.size() < MAX_DECISIONS) {
                    decisions.add(new String[] {
                            block ? "blocked" : "warned",
                            domain,
                            FilterRules.categoryName(matched),
                            String.valueOf(System.currentTimeMillis())
                    });
                }
            }
        }

        byte[] response;
        if (block) {
            response = Dns.refuse(query);
        } else {
            DatagramPacket ask = new DatagramPacket(
                    query, query.length, InetAddress.getByName(UPSTREAM_DNS), 53);
            upstream.send(ask);

            byte[] replyBuffer = new byte[4096];
            DatagramPacket reply = new DatagramPacket(replyBuffer, replyBuffer.length);
            try {
                upstream.receive(reply);
            } catch (Exception timeout) {
                // Upstream unreachable: fail OPEN with a server-failure reply so
                // the child's browser retries normally. Failing closed here would
                // look like a broken internet connection.
                response = Dns.servfail(query);
                writeBack(packet, ihl, udpStart, response, out);
                return;
            }
            response = new byte[reply.getLength()];
            System.arraycopy(replyBuffer, 0, response, 0, reply.getLength());
        }

        writeBack(packet, ihl, udpStart, response, out);
    }

    /** Builds an IPv4+UDP packet back to the app that asked, with src/dst swapped. */
    private void writeBack(byte[] request, int ihl, int udpStart, byte[] payload, FileOutputStream out)
            throws Exception {
        int total = ihl + 8 + payload.length;
        ByteBuffer p = ByteBuffer.allocate(total);

        p.put(request, 0, ihl);
        p.position(2);
        p.putShort((short) total);
        // Swap addresses: the reply comes from the resolver to the caller.
        p.position(12);
        byte[] src = new byte[4];
        byte[] dst = new byte[4];
        System.arraycopy(request, 12, src, 0, 4);
        System.arraycopy(request, 16, dst, 0, 4);
        p.put(dst);
        p.put(src);

        // Zero and recompute the IPv4 header checksum.
        p.position(10);
        p.putShort((short) 0);
        p.position(0);
        byte[] header = new byte[ihl];
        p.get(header, 0, ihl);
        int checksum = Dns.checksum(header, 0, ihl);
        p.position(10);
        p.putShort((short) checksum);

        // UDP header: swap ports, new length, checksum 0 (legal for IPv4).
        p.position(udpStart);
        int srcPort = ((request[udpStart] & 0xFF) << 8) | (request[udpStart + 1] & 0xFF);
        int dstPort = ((request[udpStart + 2] & 0xFF) << 8) | (request[udpStart + 3] & 0xFF);
        p.putShort((short) dstPort);
        p.putShort((short) srcPort);
        p.putShort((short) (8 + payload.length));
        p.putShort((short) 0);
        p.put(payload);

        out.write(p.array(), 0, total);
    }

    private void record(String domain, boolean blocked, int category) {
        synchronized (tally) {
            long[] v = tally.get(domain);
            if (v == null) {
                if (tally.size() >= MAX_TALLY) {
                    // Drop the oldest entry; this is a report, not an audit log.
                    java.util.Iterator<String> it = tally.keySet().iterator();
                    if (it.hasNext()) {
                        it.next();
                        it.remove();
                    }
                }
                v = new long[] { 0, 0, 0, 0 };
                tally.put(domain, v);
            }
            v[0] += 1;
            v[1] = System.currentTimeMillis();
            if (blocked) v[2] = 1;
            if (category != 0) v[3] = category;
        }
    }

    private void teardown() {
        running = false;
        if (worker != null) worker.interrupt();
        worker = null;
        try {
            if (tunnel != null) tunnel.close();
        } catch (Exception ignored) {
        }
        tunnel = null;
    }

    @Override
    public void onDestroy() {
        teardown();
        super.onDestroy();
    }

    @Override
    public void onRevoke() {
        // The child (or another VPN app) turned us off. Leave a marker so the
        // agent can report it rather than the parent silently losing filtering.
        decisions.add(new String[] { "revoked", "", "", String.valueOf(System.currentTimeMillis()) });
        teardown();
        super.onRevoke();
    }
}
