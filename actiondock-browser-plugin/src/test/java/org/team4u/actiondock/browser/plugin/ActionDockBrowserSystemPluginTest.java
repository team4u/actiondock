package org.team4u.actiondock.browser.plugin;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.plugin.api.PluginManifest;
import org.team4u.actiondock.plugin.api.PluginManifestLoader;

import java.util.List;
import java.util.Map;

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
                        "sessionCreate",
                        "observe",
                        "capabilities",
                        "goto",
                        "click",
                        "fill",
                        "setChecked",
                        "waitForSelector",
                        "pageList",
                        "cookiesGet",
                        "networkRoute",
                        "mouse",
                        "advancedAction",
                        "evaluate",
                        "events",
                        "sessionInfo",
                        "sessionList",
                        "sessionClose"
                )
                .doesNotContain("act", "wait", "pages");

        assertThat(manifest.getActions().stream()
                .filter(action -> "setChecked".equals(action.getAction()))
                .findFirst()
                .orElseThrow()
                .getInputSchema())
                .extractingByKey("required")
                .asList()
                .contains("sessionId", "target", "checked");

        Map<String, Object> observeSchema = manifest.getActions().stream()
                .filter(action -> "observe".equals(action.getAction()))
                .findFirst()
                .orElseThrow()
                .getOutputSchema();
        assertThat(propertiesOf(observeSchema))
                .containsKeys("ok", "sessionId", "pageId", "url", "title", "elements", "suggestedActions", "events");

        Map<String, Object> elementsSchema = nestedSchema(observeSchema, "elements");
        assertThat(elementsSchema).containsEntry("type", "array");
        assertThat(propertiesOf((Map<String, Object>) elementsSchema.get("items")))
                .containsKeys("ref", "selector", "role", "name", "label", "placeholder", "testId", "bounds");

        Map<String, Object> targetSchema = manifest.getActions().stream()
                .filter(action -> "fill".equals(action.getAction()))
                .findFirst()
                .orElseThrow()
                .getInputSchema();
        assertThat(propertiesOf(nestedSchema(targetSchema, "target")))
                .containsKeys("altText", "index");

        Map<String, Object> pdfSchema = manifest.getActions().stream()
                .filter(action -> "pdf".equals(action.getAction()))
                .findFirst()
                .orElseThrow()
                .getInputSchema();
        assertThat(propertiesOf(pdfSchema))
                .containsKeys("displayHeaderFooter", "headerTemplate", "footerTemplate", "preferCSSPageSize", "outline", "tagged");
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

    @SuppressWarnings("unchecked")
    private static Map<String, Object> propertiesOf(Map<String, Object> schema) {
        return (Map<String, Object>) schema.get("properties");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> nestedSchema(Map<String, Object> schema, String key) {
        return (Map<String, Object>) propertiesOf(schema).get(key);
    }
}
