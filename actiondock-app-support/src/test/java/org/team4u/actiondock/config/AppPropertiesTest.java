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
        assertThat(properties.getSkills().getDir()).isEqualTo(Path.of(properties.getHomeDir(), "skills").toString());
        assertThat(properties.getExecution().getPython().getEnvCacheDir()).isEqualTo(Path.of(properties.getHomeDir(), "python-envs").toString());
        assertThat(properties.getRepositories().isAutoSyncEnabled()).isTrue();
        assertThat(properties.getRepositories().getAutoSyncIntervalSeconds()).isEqualTo(1800);
        assertThat(properties.getExecution().getGroovy().isEnabled()).isTrue();
        assertThat(properties.getExecution().getGroovy().getCacheMaxSize()).isEqualTo(128);
        assertThat(properties.getExecution().getGroovy().getCacheExpireAfterAccessMinutes()).isEqualTo(30);
        assertThat(properties.getSchedules().getPoolSize()).isEqualTo(2);
    }

    @Test
    void defaultHomeDirFollowsActiondockHomeEnv() {
        String configured = Path.of("/opt", "actiondock-home").toString();

        String actual = AppProperties.defaultHomeDir(key -> "ACTIONDOCK_HOME".equals(key) ? configured : null);

        assertThat(actual).isEqualTo(configured);
    }

    @Test
    void defaultHomeDirIgnoresBlankActiondockHomeEnv() {
        String expected = Path.of(System.getProperty("user.home"), ".actiondock").toString();

        String actual = AppProperties.defaultHomeDir(key -> "ACTIONDOCK_HOME".equals(key) ? "   " : null);

        assertThat(actual).isEqualTo(expected);
    }
}
