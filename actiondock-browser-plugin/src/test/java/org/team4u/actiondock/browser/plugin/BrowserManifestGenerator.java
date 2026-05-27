package org.team4u.actiondock.browser.plugin;

import org.team4u.actiondock.plugin.api.PluginObjectMappers;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

final class BrowserManifestGenerator {
    private BrowserManifestGenerator() {
    }

    public static void main(String[] args) throws Exception {
        Path output = Path.of(args.length == 0
                ? "actiondock-browser-plugin/src/main/resources/META-INF/actiondock/plugins/actiondock-browser.json"
                : args[0]);
        Map<String, Object> manifest = new LinkedHashMap<>();
        manifest.put("id", "actiondock-browser");
        manifest.put("pluginId", "actiondock-browser");
        manifest.put("name", "ActionDock Browser");
        manifest.put("description", "AI-first Playwright browser gateway. Actions are intentionally precise so AI can call browser operations without guessing hidden op-specific params.");
        manifest.put("version", "0.1.0");
        manifest.put("configSchema", configSchema());
        manifest.put("defaultConfig", Map.ofEntries(
                Map.entry("defaultBrowser", "chromium"),
                Map.entry("headless", true),
                Map.entry("defaultTimeoutMs", 30000),
                Map.entry("sessionTtlSeconds", 600),
                Map.entry("maxSessions", 10),
                Map.entry("maxOutputChars", 50000),
                Map.entry("markUntrustedContent", true),
                Map.entry("stateDir", ".actiondock/browser-state"),
                Map.entry("artifactDir", ".actiondock/browser-artifacts"),
                Map.entry("downloadDir", ".actiondock/browser-downloads"),
                Map.entry("allowedHosts", java.util.List.of()),
                Map.entry("includeCookieValueByDefault", false),
                Map.entry("actionPolicyPath", "")
        ));
        manifest.put("actions", BrowserActionSpecs.actions());
        Files.createDirectories(output.getParent());
        PluginObjectMappers.DEFAULT.writerWithDefaultPrettyPrinter().writeValue(output.toFile(), manifest);
    }

    private static Map<String, Object> configSchema() {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("defaultBrowser", Map.of("type", "string", "enum", java.util.List.of("chromium", "firefox", "webkit"), "title", "Default Browser"));
        properties.put("headless", Map.of("type", "boolean", "title", "Headless"));
        properties.put("defaultTimeoutMs", Map.of("type", "integer", "title", "Default Timeout Milliseconds"));
        properties.put("sessionTtlSeconds", Map.of("type", "integer", "title", "Session TTL Seconds"));
        properties.put("maxSessions", Map.of("type", "integer", "title", "Max Sessions"));
        properties.put("stateDir", Map.of("type", "string", "title", "State Directory"));
        properties.put("artifactDir", Map.of("type", "string", "title", "Artifact Directory"));
        properties.put("downloadDir", Map.of("type", "string", "title", "Download Directory"));
        properties.put("allowedHosts", Map.of("type", "array", "items", Map.of("type", "string"), "title", "Allowed Hosts"));
        properties.put("includeCookieValueByDefault", Map.of("type", "boolean", "title", "Include Cookie Value By Default"));
        properties.put("maxOutputChars", Map.of("type", "integer", "title", "Max Output Characters"));
        properties.put("markUntrustedContent", Map.of("type", "boolean", "title", "Mark Untrusted Content"));
        properties.put("actionPolicyPath", Map.of("type", "string", "title", "Action Policy Path"));
        return Map.of("type", "object", "properties", properties);
    }
}
