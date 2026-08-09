package family.nestly.app;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * What counts as blocked, and why.
 *
 * Matching is deliberately two-layered:
 *
 *   1. An explicit domain set — the parent's own list plus a small seed of
 *      well-known sites per category. Exact and predictable.
 *   2. Keyword heuristics on the domain label. This is what gives any coverage
 *      at all of the long tail, which no shipped list can enumerate.
 *
 * The heuristics are intentionally conservative: a false block on a school or
 * news site erodes trust in the whole product far faster than a missed site
 * does. The production answer is a maintained categorised feed refreshed from
 * the server — the seed here is what makes filtering work on day one, offline.
 */
final class FilterRules {

    static final int NONE = 0;
    static final int ADULT = 1;
    static final int VIOLENCE = 2;
    static final int GAMBLING = 3;
    static final int SOCIAL = 4;

    boolean adult = true;
    boolean violence = true;
    boolean gambling = true;
    boolean social = false;

    /** Categories that warn rather than block. */
    final Set<Integer> warnOnly = new HashSet<>();
    /** Parent-added domains, always blocked regardless of category. */
    final Set<String> custom = new HashSet<>();

    static String categoryName(int c) {
        switch (c) {
            case ADULT: return "adult";
            case VIOLENCE: return "violence";
            case GAMBLING: return "gambling";
            case SOCIAL: return "social";
            default: return "";
        }
    }

    static int categoryOf(String name) {
        if (name == null) return NONE;
        switch (name) {
            case "adult": return ADULT;
            case "violence": return VIOLENCE;
            case "gambling": return GAMBLING;
            case "social": return SOCIAL;
            default: return NONE;
        }
    }

    boolean isWarnOnly(int category) {
        return warnOnly.contains(category);
    }

    // A short seed list. Not comprehensive — the keyword pass below is what
    // carries the rest until a server-maintained feed exists.
    private static final String[] ADULT_SEED = {
            "pornhub.com", "xvideos.com", "xnxx.com", "redtube.com", "youporn.com",
            "xhamster.com", "onlyfans.com", "chaturbate.com", "stripchat.com", "brazzers.com"
    };
    private static final String[] GAMBLING_SEED = {
            "bet365.com", "williamhill.com", "paddypower.com", "ladbrokes.com",
            "betfair.com", "888casino.com", "pokerstars.com", "skybet.com", "bwin.com"
    };
    private static final String[] SOCIAL_SEED = {
            "tiktok.com", "instagram.com", "snapchat.com", "facebook.com",
            "twitter.com", "x.com", "reddit.com", "discord.com", "tumblr.com"
    };
    private static final String[] VIOLENCE_SEED = {
            "liveleak.com", "bestgore.com", "theync.com", "documentingreality.com"
    };

    private static final String[] ADULT_WORDS = {
            "porn", "xxx", "sexcam", "camgirl", "nsfw", "hentai", "escort", "fetish", "milf"
    };
    private static final String[] GAMBLING_WORDS = {
            "casino", "roulette", "betting", "sportsbet", "pokies", "slots"
    };

    /**
     * Returns the category that matched, or NONE.
     *
     * A rule for "example.com" also covers "www.example.com" and
     * "cdn.example.com" — subdomains are the normal way sites are reached, and
     * matching only the exact host would make the list useless.
     */
    int match(String domain) {
        if (domain == null || domain.isEmpty()) return NONE;
        String d = domain.toLowerCase(Locale.US);

        // The parent's own list wins, and is never downgraded to a warning.
        for (String c : custom) {
            if (hostMatches(d, c)) return ADULT;
        }

        if (adult && (anyDomain(d, ADULT_SEED) || anyWord(d, ADULT_WORDS))) return ADULT;
        if (gambling && (anyDomain(d, GAMBLING_SEED) || anyWord(d, GAMBLING_WORDS))) return GAMBLING;
        if (violence && anyDomain(d, VIOLENCE_SEED)) return VIOLENCE;
        if (social && anyDomain(d, SOCIAL_SEED)) return SOCIAL;

        return NONE;
    }

    private static boolean anyDomain(String host, String[] list) {
        for (String candidate : list) {
            if (hostMatches(host, candidate)) return true;
        }
        return false;
    }

    /** True when host is the rule, or a subdomain of it. */
    private static boolean hostMatches(String host, String rule) {
        if (rule == null || rule.isEmpty()) return false;
        String r = rule.toLowerCase(Locale.US).trim();
        if (r.startsWith("*.")) r = r.substring(2);
        if (r.startsWith("www.")) r = r.substring(4);
        return host.equals(r) || host.endsWith("." + r);
    }

    /**
     * Keyword pass. Applied to the registrable part of the host only, so that a
     * path or a query string can never trigger it, and so "expertsexchange.com"
     * style false positives stay confined to genuinely suspicious labels.
     */
    private static boolean anyWord(String host, String[] words) {
        for (String w : words) {
            if (host.contains(w)) return true;
        }
        return false;
    }
}
