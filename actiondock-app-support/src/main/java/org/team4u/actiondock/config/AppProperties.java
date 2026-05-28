package org.team4u.actiondock.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * 应用配置属性，绑定 {@code app.*} 前缀的配置项。
 * <p>
 * 包含认证、插件、执行引擎和调度等子配置。
 *
 * @author jay.wu
 */
@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private String homeDir = defaultHomeDir();
    private final Plugins plugins = new Plugins();
    private final Skills skills = new Skills();
    private final Repositories repositories = new Repositories();
    private final Execution execution = new Execution();
    private final Schedules schedules = new Schedules();
    private final SharedState sharedState = new SharedState();
    private final Cors cors = new Cors();

    public String getHomeDir() {
        return homeDir;
    }

    public void setHomeDir(String homeDir) {
        this.homeDir = homeDir;
    }

    public Execution getExecution() {
        return execution;
    }

    public Plugins getPlugins() {
        return plugins;
    }

    public Repositories getRepositories() {
        return repositories;
    }

    public Skills getSkills() {
        return skills;
    }

    public Schedules getSchedules() {
        return schedules;
    }

    public SharedState getSharedState() {
        return sharedState;
    }

    public Cors getCors() {
        return cors;
    }

    public static String defaultHomeDir() {
        return Path.of(System.getProperty("user.home"), ".actiondock").toString();
    }

    public static String defaultPluginsDir() {
        return Path.of(defaultHomeDir(), "plugins").toString();
    }

    public static String defaultSkillsDir() {
        return Path.of(defaultHomeDir(), "skills").toString();
    }

    public static class Execution {
        private int asyncPoolSize = 4;
        private String artifactRootDir = Path.of(defaultHomeDir(), "runs").toString();
        private final Groovy groovy = new Groovy();
        private final Python python = new Python();
        private final Shell shell = new Shell();

        public int getAsyncPoolSize() {
            return asyncPoolSize;
        }

        public void setAsyncPoolSize(int asyncPoolSize) {
            this.asyncPoolSize = asyncPoolSize;
        }

        public String getArtifactRootDir() {
            return artifactRootDir;
        }

        public void setArtifactRootDir(String artifactRootDir) {
            this.artifactRootDir = artifactRootDir;
        }

        public Groovy getGroovy() {
            return groovy;
        }

        public Python getPython() {
            return python;
        }

        public Shell getShell() {
            return shell;
        }
    }

    public static class Plugins {
        private String dir = defaultPluginsDir();

        public String getDir() {
            return dir;
        }

        public void setDir(String dir) {
            this.dir = dir;
        }
    }

    public static class Skills {
        private String dir = defaultSkillsDir();

        public String getDir() {
            return dir;
        }

        public void setDir(String dir) {
            this.dir = dir;
        }
    }

    public static class Repositories {
        private boolean autoSyncEnabled = true;
        private int autoSyncIntervalSeconds = 1800;

        public boolean isAutoSyncEnabled() {
            return autoSyncEnabled;
        }

        public void setAutoSyncEnabled(boolean autoSyncEnabled) {
            this.autoSyncEnabled = autoSyncEnabled;
        }

        public int getAutoSyncIntervalSeconds() {
            return autoSyncIntervalSeconds;
        }

        public void setAutoSyncIntervalSeconds(int autoSyncIntervalSeconds) {
            this.autoSyncIntervalSeconds = autoSyncIntervalSeconds;
        }
    }

    public static class Groovy {
        private boolean enabled = true;
        private int cacheMaxSize = 128;
        private int cacheExpireAfterAccessMinutes = 30;

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public int getCacheMaxSize() {
            return cacheMaxSize;
        }

        public void setCacheMaxSize(int cacheMaxSize) {
            this.cacheMaxSize = cacheMaxSize;
        }

        public int getCacheExpireAfterAccessMinutes() {
            return cacheExpireAfterAccessMinutes;
        }

        public void setCacheExpireAfterAccessMinutes(int cacheExpireAfterAccessMinutes) {
            this.cacheExpireAfterAccessMinutes = cacheExpireAfterAccessMinutes;
        }
    }

    public static class Python {
        private String executable = "python3";
        private int timeoutSeconds = 30;
        private String envCacheDir = Path.of(defaultHomeDir(), "python-envs").toString();
        private int installTimeoutSeconds = 300;

        public String getExecutable() {
            return executable;
        }

        public void setExecutable(String executable) {
            this.executable = executable;
        }

        public int getTimeoutSeconds() {
            return timeoutSeconds;
        }

        public void setTimeoutSeconds(int timeoutSeconds) {
            this.timeoutSeconds = timeoutSeconds;
        }

        public String getEnvCacheDir() {
            return envCacheDir;
        }

        public void setEnvCacheDir(String envCacheDir) {
            this.envCacheDir = envCacheDir;
        }

        public int getInstallTimeoutSeconds() {
            return installTimeoutSeconds;
        }

        public void setInstallTimeoutSeconds(int installTimeoutSeconds) {
            this.installTimeoutSeconds = installTimeoutSeconds;
        }
    }

    public static class Shell {
        private int timeoutSeconds = 30;
        private int maxOutputBytes = 1024 * 1024;

        public int getTimeoutSeconds() {
            return timeoutSeconds;
        }

        public void setTimeoutSeconds(int timeoutSeconds) {
            this.timeoutSeconds = timeoutSeconds;
        }

        public int getMaxOutputBytes() {
            return maxOutputBytes;
        }

        public void setMaxOutputBytes(int maxOutputBytes) {
            this.maxOutputBytes = maxOutputBytes;
        }
    }

    public static class Schedules {
        private int poolSize = 2;

        public int getPoolSize() {
            return poolSize;
        }

        public void setPoolSize(int poolSize) {
            this.poolSize = poolSize;
        }
    }

    public static class SharedState {
        private int purgeIntervalSeconds = 300;

        public int getPurgeIntervalSeconds() {
            return purgeIntervalSeconds;
        }

        public void setPurgeIntervalSeconds(int purgeIntervalSeconds) {
            this.purgeIntervalSeconds = purgeIntervalSeconds;
        }
    }

    public static class Cors {
        private List<String> allowedOrigins = new ArrayList<>(List.of("*"));

        public List<String> getAllowedOrigins() {
            return allowedOrigins;
        }

        public void setAllowedOrigins(List<String> allowedOrigins) {
            this.allowedOrigins = allowedOrigins;
        }
    }
}
