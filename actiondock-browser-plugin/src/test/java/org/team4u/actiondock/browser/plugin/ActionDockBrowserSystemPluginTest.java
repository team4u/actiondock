package org.team4u.actiondock.browser.plugin;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.plugin.api.PluginManifest;
import org.team4u.actiondock.plugin.api.PluginManifestLoader;
import org.team4u.actiondock.plugin.api.PluginObjectMappers;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.io.InputStream;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ActionDockBrowserSystemPluginTest {
    @Test
    void exposesManifestAndActions() {
        ActionDockBrowserSystemPlugin plugin = new ActionDockBrowserSystemPlugin();

        PluginManifest manifest = PluginManifestLoader.load(plugin.getClass(), plugin.id());

        assertThat(plugin.id()).isEqualTo("actiondock-browser");
        assertThat(manifest.getActions())
                .extracting("action")
                .contains(
                        "open",
                        "snapshot",
                        "click",
                        "fill",
                        "keyboardType",
                        "scroll",
                        "mouseMove",
                        "press",
                        "getText",
                        "getTitle",
                        "isVisible",
                        "waitForUrl",
                        "findClick",
                        "tabNew",
                        "tabSwitch",
                        "sessionInfo",
                        "cookiesSet",
                        "storageGet",
                        "networkRequest",
                        "consoleList",
                        "traceStart",
                        "snapshotDiff",
                        "eval",
                        "batch",
                        "capabilities"
                )
                .doesNotContain(
                        "act",
                        "find",
                        "get",
                        "is",
                        "wait",
                        "tab",
                        "session",
                        "capture",
                        "dialog",
                        "cookies",
                        "storage",
                        "network",
                        "sessionCreate",
                        "observe",
                        "goto",
                        "waitForSelector",
                        "pageList",
                        "cookiesGet",
                        "advancedAction",
                        "evaluate"
                );

        Map<String, Object> snapshotSchema = manifest.getActions().stream()
                .filter(action -> "snapshot".equals(action.getAction()))
                .findFirst()
                .orElseThrow()
                .getOutputSchema();
        assertThat(propertiesOf(snapshotSchema))
                .containsKeys("ok", "session", "tab", "url", "title", "elements", "suggestions", "events",
                        "snapshotId", "pageVersion", "scope", "truncated", "elementCount", "outputMeta");

        Map<String, Object> elementsSchema = nestedSchema(snapshotSchema, "elements");
        assertThat(elementsSchema).containsEntry("type", "array");
        assertThat(propertiesOf((Map<String, Object>) elementsSchema.get("items")))
                .containsKeys("ref", "selector", "role", "name", "label", "placeholder", "testId", "bounds", "interactive");

        Map<String, Object> fillSchema = manifest.getActions().stream()
                .filter(action -> "fill".equals(action.getAction()))
                .findFirst()
                .orElseThrow()
                .getInputSchema();
        assertThat(propertiesOf(fillSchema))
                .containsKeys("session", "tab", "target", "snapshotId", "text", "exact", "index");
        assertThat(propertiesOf(fillSchema)).doesNotContainKey("op");
        assertThat(propertiesOf(fillSchema).get("target"))
                .as("target is a flat selector string, not a nested schema")
                .extracting("type")
                .isEqualTo("string");

        Map<String, Object> openAction = manifest.getActions().stream()
                .filter(action -> "open".equals(action.getAction()))
                .findFirst()
                .orElseThrow()
                .getExampleArgs();
        assertThat(openAction).doesNotContainKeys("session", "url");
        Map<String, Object> openHints = manifest.getActions().stream()
                .filter(action -> "open".equals(action.getAction()))
                .findFirst()
                .orElseThrow()
                .getAiHints();
        assertThat(openHints)
                .containsEntry("sessionGeneratedWhenOmitted", true)
                .doesNotContainKey("sessionRequired");

        Map<String, Object> sessionListSchema = manifest.getActions().stream()
                .filter(action -> "sessionList".equals(action.getAction()))
                .findFirst()
                .orElseThrow()
                .getInputSchema();
        assertThat(propertiesOf(sessionListSchema)).doesNotContainKey("session");

        Map<String, Object> pressSchema = manifest.getActions().stream()
                .filter(action -> "press".equals(action.getAction()))
                .findFirst()
                .orElseThrow()
                .getInputSchema();
        assertThat(propertiesOf(pressSchema)).containsKeys("key").doesNotContainKey("op");

        Map<String, Object> cookiesSetSchema = manifest.getActions().stream()
                .filter(action -> "cookiesSet".equals(action.getAction()))
                .findFirst()
                .orElseThrow()
                .getInputSchema();
        assertThat(propertiesOf(cookiesSetSchema)).containsKeys("name", "value", "url", "cookiesJson").doesNotContainKey("op");

        Set<String> actionNames = manifest.getActions().stream().map(action -> action.getAction()).collect(Collectors.toSet());
        assertThat(actionNames).hasSizeGreaterThan(50);
    }

    @Test
    void validatesConfig() {
        ActionDockBrowserSystemPlugin plugin = new ActionDockBrowserSystemPlugin();

        plugin.validateConfig(Map.of(
                "defaultBrowser", "chromium",
                "headless", true,
                "defaultTimeoutMs", 30000,
                "sessionTtlSeconds", 600,
                "maxSessions", 10,
                "maxOutputChars", 50000,
                "stateDir", ".actiondock/browser-state",
                "artifactDir", ".actiondock/browser-artifacts",
                "downloadDir", ".actiondock/browser-downloads"
        ));

        assertThatThrownBy(() -> plugin.validateConfig(Map.of("defaultBrowser", "unknown")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("defaultBrowser");
    }

    @Test
    void pf4jExtensionUsesInstallablePluginMetadata() {
        ActionDockBrowserPluginExtension plugin = new ActionDockBrowserPluginExtension();

        PluginManifest manifest = PluginManifestLoader.load(plugin.getClass(), plugin.id());

        assertThat(plugin.id()).isEqualTo("actiondock-browser");
        assertThat(manifest.getPluginId()).isEqualTo("actiondock-browser");
        assertThat(manifest.getVersion()).isEqualTo("0.1.0");
    }

    @Test
    void manifestCarriesLegacyIdAliasForInstallers() throws Exception {
        try (InputStream inputStream = ActionDockBrowserPluginExtension.class.getClassLoader()
                .getResourceAsStream("META-INF/actiondock/plugins/actiondock-browser.json")) {
            assertThat(inputStream).isNotNull();
            Map<String, Object> manifest = PluginObjectMappers.DEFAULT.readValue(inputStream, Map.class);
            assertThat(manifest)
                    .containsEntry("id", "actiondock-browser")
                    .containsEntry("pluginId", "actiondock-browser");
        }
    }

    @Test
    void wrapsUnknownExceptionsAsInternalPluginFailures() {
        NullPointerException cause = new NullPointerException("boom");

        assertThatThrownBy(() -> {
            throw BrowserErrors.wrap("snapshot", cause);
        })
                .isInstanceOfSatisfying(PluginRuntimeException.class, exception -> {
                    assertThat(exception.getStatus()).isEqualTo(500);
                    assertThat(exception.getCode()).isEqualTo("PLUGIN_ACTION_FAILED");
                    assertThat(exception.getMessage()).isEqualTo("boom");
                    assertThat(exception.getDetails())
                            .containsEntry("action", "snapshot")
                            .containsEntry("causeType", NullPointerException.class.getName());
                    assertThat(exception.getCause()).isSameAs(cause);
                });
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> propertiesOf(Map<String, Object> schema) {
        return (Map<String, Object>) schema.get("properties");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> nestedSchema(Map<String, Object> schema, String key) {
        return (Map<String, Object>) propertiesOf(schema).get(key);
    }
}
