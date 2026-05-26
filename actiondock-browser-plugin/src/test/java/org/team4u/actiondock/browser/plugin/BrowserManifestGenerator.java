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
        manifest.put("pluginId", "actiondock-browser");
        manifest.put("name", "ActionDock Browser");
        manifest.put("description", "AI-first Playwright browser gateway. Actions are intentionally precise so AI can call browser operations without guessing hidden op-specific params.");
        manifest.put("version", "0.3.0");
        manifest.put("configSchema", configSchema());
        manifest.put("defaultConfig", Map.of(
                "defaultBrowser", "chromium",
                "headless", true,
                "defaultTimeoutMs", 30000,
                "sessionTtlSeconds", 600,
                "maxSessions", 10,
                "stateDir", ".actiondock/browser-state",
                "artifactDir", ".actiondock/browser-artifacts",
                "downloadDir", ".actiondock/browser-downloads",
                "allowedHosts", java.util.List.of(),
                "includeCookieValueByDefault", false
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
        return Map.of("type", "object", "properties", properties);
    }
}
