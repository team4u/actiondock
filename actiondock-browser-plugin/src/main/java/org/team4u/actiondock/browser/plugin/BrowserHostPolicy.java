package org.team4u.actiondock.browser.plugin;

import java.net.URI;
import java.util.Locale;

final class BrowserHostPolicy {
    void assertAllowed(BrowserPluginConfig config, String url) {
        if (config.getAllowedHosts() == null || config.getAllowedHosts().isEmpty()) {
            return;
        }
        String host = URI.create(url).getHost();
        if (Args.isBlank(host)) {
            throw new IllegalArgumentException("url host is required when allowedHosts is configured");
        }
        String normalizedHost = host.toLowerCase(Locale.ROOT);
        boolean allowed = config.getAllowedHosts().stream()
                .filter(item -> item != null && !item.isBlank())
                .map(item -> item.toLowerCase(Locale.ROOT))
                .anyMatch(allowedHost -> normalizedHost.equals(allowedHost) || normalizedHost.endsWith("." + allowedHost));
        if (!allowed) {
            throw new IllegalArgumentException("Host is not allowed: " + host);
        }
    }
}
