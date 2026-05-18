package org.team4u.actiondock.plugin.api;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PluginConfigBinderTest {
    @Test
    void bindsMapToConfigType() {
        SamplePluginConfig config = PluginConfigBinder.bind(
                Map.of("prefix", "demo", "enabled", true),
                SamplePluginConfig.class
        );

        assertThat(config.getPrefix()).isEqualTo("demo");
        assertThat(config.isEnabled()).isTrue();
    }

    @Test
    void doesNotApplyDefaultsForEmptySource() {
        SamplePluginConfig config = PluginConfigBinder.bind(Map.of(), SamplePluginConfig.class);

        assertThat(config.getPrefix()).isNull();
        assertThat(config.isEnabled()).isFalse();
    }

    @Test
    void ignoresUnknownFields() {
        SamplePluginConfig config = PluginConfigBinder.bind(
                Map.of("prefix", "hello", "unknown", "ignored"),
                SamplePluginConfig.class
        );

        assertThat(config.getPrefix()).isEqualTo("hello");
    }

    @Test
    void reportsBindingPathWhenTypeConversionFails() {
        assertThatThrownBy(() -> PluginConfigBinder.bind(
                Map.of("nested", Map.of("retries", "oops")),
                NestedPluginConfig.class
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("nested.retries");
    }

    @Test
    void scriptPluginContextSupportsTypedConfigAccess() {
        ScriptPluginContext context = new ScriptPluginContext()
                .setPluginConfig(Map.of("prefix", "context"));

        SamplePluginConfig config = context.getPluginConfig(SamplePluginConfig.class);

        assertThat(config.getPrefix()).isEqualTo("context");
        assertThat(config.isEnabled()).isFalse();
    }

    public static class SamplePluginConfig {
        private String prefix;
        private boolean enabled;

        public String getPrefix() {
            return prefix;
        }

        public void setPrefix(String prefix) {
            this.prefix = prefix;
        }

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }
    }

    public static class NestedPluginConfig {
        private RetryConfig nested;

        public RetryConfig getNested() {
            return nested;
        }

        public void setNested(RetryConfig nested) {
            this.nested = nested;
        }
    }

    public static class RetryConfig {
        private int retries;

        public int getRetries() {
            return retries;
        }

        public void setRetries(int retries) {
            this.retries = retries;
        }
    }
}
