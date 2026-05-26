package org.team4u.actiondock.browser.plugin;

import java.util.Set;

final class BrowserConfigValidator {
    private static final Set<String> SUPPORTED_BROWSERS = Set.of("chromium", "firefox", "webkit");

    private BrowserConfigValidator() {
    }

    static void validate(BrowserPluginConfig config) {
        if (config == null) {
            throw new IllegalArgumentException("browser plugin config must not be null");
        }
        if (!SUPPORTED_BROWSERS.contains(normalizeBrowser(config.getDefaultBrowser()))) {
            throw new IllegalArgumentException("defaultBrowser must be one of chromium, firefox, webkit");
        }
        if (config.getDefaultTimeoutMs() <= 0) {
            throw new IllegalArgumentException("defaultTimeoutMs must be positive");
        }
        if (config.getSessionTtlSeconds() <= 0) {
            throw new IllegalArgumentException("sessionTtlSeconds must be positive");
        }
        if (config.getMaxSessions() <= 0) {
            throw new IllegalArgumentException("maxSessions must be positive");
        }
        if (isBlank(config.getStateDir())) {
            throw new IllegalArgumentException("stateDir must not be blank");
        }
        if (isBlank(config.getArtifactDir())) {
            throw new IllegalArgumentException("artifactDir must not be blank");
        }
        if (isBlank(config.getDownloadDir())) {
            throw new IllegalArgumentException("downloadDir must not be blank");
        }
    }

    static String normalizeBrowser(String browser) {
        return isBlank(browser) ? "chromium" : browser.trim().toLowerCase();
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
