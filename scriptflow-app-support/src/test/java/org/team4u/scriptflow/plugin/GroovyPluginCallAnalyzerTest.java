package org.team4u.scriptflow.plugin;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GroovyPluginCallAnalyzerTest {
    private final GroovyPluginCallAnalyzer analyzer = new GroovyPluginCallAnalyzer();

    @Test
    void findsLiteralPluginCalls() {
        assertThat(analyzer.findCalls("""
                def value = plugins.invoke("demo", "echo", [message: "hi"])
                return value
                """))
                .containsExactly(new GroovyPluginCallAnalyzer.PluginCallRef("demo", "echo"));
    }

    @Test
    void rejectsNonLiteralPluginId() {
        assertThatThrownBy(() -> analyzer.findCalls("""
                def pluginId = "demo"
                return plugins.invoke(pluginId, "echo")
                """))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("pluginId");
    }
}
