package org.team4u.actiondock.browser.plugin;

import com.microsoft.playwright.options.LoadState;
import com.microsoft.playwright.options.SameSiteAttribute;
import com.microsoft.playwright.options.WaitForSelectorState;
import com.microsoft.playwright.options.WaitUntilState;

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
}
