package org.team4u.scriptflow.plugin.api;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class PluginManifestLoaderTest {
    @Test
    void loadsManifestFromConventionalPathByPluginId() {
        PluginManifest manifest = PluginManifestLoader.load(PluginManifestLoaderTest.class, "sample-plugin");

        assertThat(manifest.getPluginId()).isEqualTo("sample-plugin");
        assertThat(manifest.getConfigSchema()).containsEntry("type", "object");
        assertThat(manifest.getDefaultConfig()).containsEntry("prefix", "sample");
        assertThat(manifest.getActions()).hasSize(1);
        assertThat(manifest.getActions().getFirst().getAction()).isEqualTo("echo");
    }
}
