package org.team4u.actiondock.config;

import org.junit.jupiter.api.Test;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class AppPropertiesTest {
    @Test
    void executionGroovyUsesExpectedDefaults() {
        AppProperties properties = new AppProperties();

        assertThat(properties.getHomeDir()).isEqualTo(Path.of(System.getProperty("user.home"), ".actiondock").toString());
        assertThat(properties.getPlugins().getDir()).isEqualTo(Path.of(properties.getHomeDir(), "plugins").toString());
        assertThat(properties.getRepositories().isAutoSyncEnabled()).isTrue();
        assertThat(properties.getRepositories().getAutoSyncIntervalSeconds()).isEqualTo(1800);
        assertThat(properties.getExecution().getGroovy().isEnabled()).isTrue();
        assertThat(properties.getExecution().getGroovy().getCacheMaxSize()).isEqualTo(128);
        assertThat(properties.getExecution().getGroovy().getCacheExpireAfterAccessMinutes()).isEqualTo(30);
        assertThat(properties.getSchedules().getPoolSize()).isEqualTo(2);
    }
}
