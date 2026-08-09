package family.nestly.app;

import java.util.Locale;

/**
 * Just enough DNS to read a question and write a refusal.
 *
 * Deliberately not a general DNS library: anything this does not understand is
 * forwarded to a real resolver untouched, so the failure mode of a parsing gap
 * is "not filtered", never "internet broken".
 */
final class Dns {

    private Dns() {}

    /**
     * Reads the QNAME from a DNS query, lowercased and without the trailing dot.
     * Returns null if the packet is not a plain single-question query.
     */
    static String readQuestionName(byte[] dns) {
        if (dns.length < 13) return null;

        int qdcount = ((dns[4] & 0xFF) << 8) | (dns[5] & 0xFF);
        if (qdcount < 1) return null;

        // QR bit set means this is a response, not a question.
        if ((dns[2] & 0x80) != 0) return null;

        StringBuilder name = new StringBuilder();
        int i = 12;
        int guard = 0;
        while (i < dns.length && guard++ < 128) {
            int len = dns[i] & 0xFF;
            if (len == 0) break;
            // A compression pointer in a question is malformed; bail out rather
            // than chase it.
            if ((len & 0xC0) != 0) return null;
            i++;
            if (i + len > dns.length) return null;
            if (name.length() > 0) name.append('.');
            name.append(new String(dns, i, len, java.nio.charset.StandardCharsets.US_ASCII));
            i += len;
        }
        if (name.length() == 0) return null;
        return name.toString().toLowerCase(Locale.US);
    }

    /**
     * NXDOMAIN for the same question.
     *
     * Chosen over answering 0.0.0.0 because browsers show a clean "site can't be
     * reached" instead of hanging on a connection to nowhere.
     */
    static byte[] refuse(byte[] query) {
        return respond(query, 3);
    }

    /** SERVFAIL — used when the upstream resolver is unreachable. */
    static byte[] servfail(byte[] query) {
        return respond(query, 2);
    }

    private static byte[] respond(byte[] query, int rcode) {
        byte[] out = query.clone();
        // QR=1 (response), RD copied from the query.
        out[2] = (byte) (0x80 | (query[2] & 0x01));
        // RA=1 so clients do not retry expecting recursion, plus the code.
        out[3] = (byte) (0x80 | (rcode & 0x0F));
        // No answer, authority or additional records.
        out[6] = 0; out[7] = 0;
        out[8] = 0; out[9] = 0;
        out[10] = 0; out[11] = 0;
        return out;
    }

    /** Standard one's-complement checksum, used for the IPv4 header. */
    static int checksum(byte[] data, int offset, int length) {
        int sum = 0;
        int i = offset;
        while (i < offset + length - 1) {
            sum += ((data[i] & 0xFF) << 8) | (data[i + 1] & 0xFF);
            i += 2;
        }
        if (i < offset + length) sum += (data[i] & 0xFF) << 8;
        while ((sum >> 16) != 0) sum = (sum & 0xFFFF) + (sum >> 16);
        return ~sum & 0xFFFF;
    }
}
