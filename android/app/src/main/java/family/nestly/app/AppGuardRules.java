package family.nestly.app;

import java.util.HashMap;
import java.util.Map;

/**
 * Parsed per-app rules plus the household PEGI ceiling.
 *
 * Set by the plugin from the parent's policy, read by
 * {@link NestlyAppGuardService}'s poll loop — the same static-volatile
 * hand-off {@link FilterRules} uses between the plugin and the DNS filter.
 */
final class AppGuardRules {

    static final class Rule {
        /** Minutes of foreground time allowed per day. 0 means no cap. */
        final int capMinutes;
        final boolean locked;

        Rule(int capMinutes, boolean locked) {
            this.capMinutes = capMinutes;
            this.locked = locked;
        }
    }

    final Map<String, Rule> byPackage = new HashMap<>();
    /** Highest PEGI rating allowed to run unlocked. 0 means no PEGI enforcement. */
    int maxPegi = 0;

    boolean isEmpty() {
        return byPackage.isEmpty() && maxPegi <= 0;
    }
}
