package family.nestly.app;

import java.util.HashMap;
import java.util.Map;

/**
 * A seed list of well-known apps' PEGI age rating.
 *
 * HONEST LIMITS, matching how {@link FilterRules} documents its own domain
 * seed lists. There is no public API for PEGI ratings usable offline on a
 * child's phone, so this is a short, hand-maintained list of common apps —
 * not a comprehensive database. An app not in this list is never auto-blocked
 * by a PEGI ceiling alone; a parent who wants it blocked locks it directly
 * from the app-limits screen.
 */
final class PegiRatings {

    private static final Map<String, Integer> RATINGS = new HashMap<>();

    static {
        // Social / messaging.
        RATINGS.put("com.instagram.android", 12);
        RATINGS.put("com.zhiliaoapp.musically", 12); // TikTok
        RATINGS.put("com.snapchat.android", 12);
        RATINGS.put("com.facebook.katana", 12);
        RATINGS.put("com.twitter.android", 12);
        RATINGS.put("com.reddit.frontpage", 16);
        RATINGS.put("com.discord", 12);
        RATINGS.put("com.whatsapp", 16);
        RATINGS.put("org.telegram.messenger", 16);
        RATINGS.put("com.tumblr", 16);
        // Games, spread across the age bands rather than one number.
        RATINGS.put("com.roblox.client", 7);
        RATINGS.put("com.mojang.minecraftpe", 7);
        RATINGS.put("com.king.candycrushsaga", 3);
        RATINGS.put("com.supercell.clashofclans", 7);
        RATINGS.put("com.supercell.clashroyale", 7);
        RATINGS.put("com.epicgames.fortnite", 12);
        RATINGS.put("com.innersloth.spacemafia", 7); // Among Us
        RATINGS.put("com.rovio.angrybirds", 7);
        RATINGS.put("com.dts.freefireth", 12);
        RATINGS.put("com.miHoYo.GenshinImpact", 12);
    }

    private PegiRatings() {}

    /** 0 means unrated — never auto-blocked by a PEGI ceiling alone. */
    static int ratingFor(String pkg) {
        Integer r = RATINGS.get(pkg);
        return r == null ? 0 : r;
    }
}
