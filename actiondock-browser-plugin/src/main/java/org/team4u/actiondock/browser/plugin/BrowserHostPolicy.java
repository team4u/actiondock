package org.team4u.actiondock.browser.plugin;

import java.net.URI;
import java.util.List;
import java.util.Locale;

final class BrowserHostPolicy {
    private BrowserHostPolicy() {
    }

    static void assertAllowed(BrowserPluginConfig config, String url, String action) {
        if (config == null || config.getAllowedHosts().isEmpty() || Args.isBlank(url)) {
            return;
        }
        URI uri = URI.create(url);
        String host = uri.getHost();
        if (Args.isBlank(host)) {
            return;
        }
        if (matches(host, config.getAllowedHosts())) {
            return;
        }
        throw new IllegalArgumentException("URL host is not allowed for " + action + ": " + host);
    }

    static boolean isAllowed(BrowserPluginConfig config, String url) {
        if (config == null || config.getAllowedHosts().isEmpty() || Args.isBlank(url)) {
            return true;
        }
        URI uri = URI.create(url);
        String host = uri.getHost();
        return Args.isBlank(host) || matches(host, config.getAllowedHosts());
    }

    private static boolean matches(String host, List<String> patterns) {
        String normalizedHost = host.toLowerCase(Locale.ROOT);
        for (String pattern : patterns) {
            if (Args.isBlank(pattern)) {
                continue;
            }
            String normalizedPattern = pattern.trim().toLowerCase(Locale.ROOT);
            if (normalizedPattern.startsWith("*.")) {
                String suffix = normalizedPattern.substring(2);
                if (normalizedHost.equals(suffix) || normalizedHost.endsWith("." + suffix)) {
                    return true;
                }
            } else if (normalizedHost.equals(normalizedPattern)) {
                return true;
            }
        }
        return false;
    }
}
