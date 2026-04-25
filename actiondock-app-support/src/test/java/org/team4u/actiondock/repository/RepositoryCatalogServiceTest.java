package org.team4u.actiondock.repository;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class RepositoryCatalogServiceTest {
    @Test
    void extractsLiteralPluginDependenciesFromGroovySource() {
        String source = """
                def first = plugins.invoke("plugin-a", "echo", [message: "hi"])
                def second = plugins.invoke('plugin-a', 'summarize')
                def ignored = plugins.invoke(input.pluginId, "dynamic")
                return plugins.invoke("plugin-b", "run")
                """;

        var dependencies = RepositoryCatalogService.extractPluginDependenciesFromSource(
                source,
                Map.of("plugin-a", "1.2.3", "plugin-b", "0.4.0")
        );

        assertThat(dependencies).hasSize(2);
        assertThat(dependencies.get(0).getPluginId()).isEqualTo("plugin-a");
        assertThat(dependencies.get(0).getVersionRange()).isEqualTo(">= 1.2.3");
        assertThat(dependencies.get(0).getRequiredActions()).containsExactly("echo", "summarize");
        assertThat(dependencies.get(1).getPluginId()).isEqualTo("plugin-b");
        assertThat(dependencies.get(1).getVersionRange()).isEqualTo(">= 0.4.0");
        assertThat(dependencies.get(1).getRequiredActions()).containsExactly("run");
    }
}
