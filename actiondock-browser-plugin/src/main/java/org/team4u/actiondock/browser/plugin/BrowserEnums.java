package org.team4u.actiondock.browser.plugin;

import com.microsoft.playwright.options.LoadState;
import com.microsoft.playwright.options.SameSiteAttribute;
import com.microsoft.playwright.options.WaitForSelectorState;
import com.microsoft.playwright.options.WaitUntilState;
import com.microsoft.playwright.options.ColorScheme;
import com.microsoft.playwright.options.Contrast;
import com.microsoft.playwright.options.ForcedColors;
import com.microsoft.playwright.options.Media;
import com.microsoft.playwright.options.ReducedMotion;

final class BrowserEnums {
    private BrowserEnums() {
    }

    static LoadState loadState(String value, LoadState defaultValue) {
        if (Args.isBlank(value)) {
            return defaultValue;
        }
        return switch (value.trim().toLowerCase()) {
            case "load" -> LoadState.LOAD;
            case "domcontentloaded" -> LoadState.DOMCONTENTLOADED;
            case "networkidle" -> LoadState.NETWORKIDLE;
            default -> throw new IllegalArgumentException("Unsupported load state: " + value);
        };
    }

    static WaitUntilState waitUntil(String value, WaitUntilState defaultValue) {
        if (Args.isBlank(value)) {
            return defaultValue;
        }
        return switch (value.trim().toLowerCase()) {
            case "load" -> WaitUntilState.LOAD;
            case "domcontentloaded" -> WaitUntilState.DOMCONTENTLOADED;
            case "networkidle" -> WaitUntilState.NETWORKIDLE;
            case "commit" -> WaitUntilState.COMMIT;
            default -> throw new IllegalArgumentException("Unsupported waitUntil: " + value);
        };
    }

    static WaitForSelectorState selectorState(String value, WaitForSelectorState defaultValue) {
        if (Args.isBlank(value)) {
            return defaultValue;
        }
        return switch (value.trim().toLowerCase()) {
            case "attached" -> WaitForSelectorState.ATTACHED;
            case "detached" -> WaitForSelectorState.DETACHED;
            case "visible" -> WaitForSelectorState.VISIBLE;
            case "hidden" -> WaitForSelectorState.HIDDEN;
            default -> throw new IllegalArgumentException("Unsupported selector state: " + value);
        };
    }

    static SameSiteAttribute sameSite(String value) {
        if (Args.isBlank(value)) {
            return null;
        }
        return switch (value.trim().toLowerCase()) {
            case "strict" -> SameSiteAttribute.STRICT;
            case "lax" -> SameSiteAttribute.LAX;
            case "none" -> SameSiteAttribute.NONE;
            default -> throw new IllegalArgumentException("Unsupported sameSite: " + value);
        };
    }

    static ColorScheme colorScheme(String value) {
        if (Args.isBlank(value)) {
            return null;
        }
        return switch (value.trim().toLowerCase()) {
            case "light" -> ColorScheme.LIGHT;
            case "dark" -> ColorScheme.DARK;
            case "no-preference" -> ColorScheme.NO_PREFERENCE;
            default -> throw new IllegalArgumentException("Unsupported colorScheme: " + value);
        };
    }

    static Media media(String value) {
        if (Args.isBlank(value)) {
            return null;
        }
        return switch (value.trim().toLowerCase()) {
            case "screen" -> Media.SCREEN;
            case "print" -> Media.PRINT;
            default -> throw new IllegalArgumentException("Unsupported media: " + value);
        };
    }

    static ReducedMotion reducedMotion(String value) {
        if (Args.isBlank(value)) {
            return null;
        }
        return switch (value.trim().toLowerCase()) {
            case "reduce" -> ReducedMotion.REDUCE;
            case "no-preference" -> ReducedMotion.NO_PREFERENCE;
            default -> throw new IllegalArgumentException("Unsupported reducedMotion: " + value);
        };
    }

    static ForcedColors forcedColors(String value) {
        if (Args.isBlank(value)) {
            return null;
        }
        return switch (value.trim().toLowerCase()) {
            case "active" -> ForcedColors.ACTIVE;
            case "none" -> ForcedColors.NONE;
            default -> throw new IllegalArgumentException("Unsupported forcedColors: " + value);
        };
    }

    static Contrast contrast(String value) {
        if (Args.isBlank(value)) {
            return null;
        }
        return switch (value.trim().toLowerCase()) {
            case "more" -> Contrast.MORE;
            case "no-preference" -> Contrast.NO_PREFERENCE;
            default -> throw new IllegalArgumentException("Unsupported contrast: " + value);
        };
    }
}
