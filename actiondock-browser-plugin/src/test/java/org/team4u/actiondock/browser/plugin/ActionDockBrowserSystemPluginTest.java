package org.team4u.actiondock.browser.plugin;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.plugin.api.PluginManifest;
import org.team4u.actiondock.plugin.api.PluginManifestLoader;

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
}
