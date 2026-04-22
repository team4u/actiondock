package org.team4u.scriptflow.config;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class AppPropertiesTest {
    @Test
    void executionGroovyUsesExpectedDefaults() {
        AppProperties properties = new AppProperties();

        assertThat(properties.getPlugins().getDir()).isEqualTo("./plugins");
        assertThat(properties.getExecution().getGroovy().isEnabled()).isTrue();
        assertThat(properties.getExecution().getGroovy().getCacheMaxSize()).isEqualTo(128);
        assertThat(properties.getExecution().getGroovy().getCacheExpireAfterAccessMinutes()).isEqualTo(30);
    }
}
