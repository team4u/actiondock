package org.team4u.actiondock.plugin;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 插件配置视图，展示插件的配置模式、默认配置和当前生效配置。
 *
 * @author jay.wu
 */
public class PluginConfigView {
    private String pluginId;
    private Map<String, Object> configSchema = new LinkedHashMap<>();
    private Map<String, Object> defaultConfig = new LinkedHashMap<>();
    private Map<String, Object> config = new LinkedHashMap<>();

    public String getPluginId() {
        return pluginId;
    }

    public PluginConfigView setPluginId(String pluginId) {
        this.pluginId = pluginId;
        return this;
    }

    public Map<String, Object> getConfigSchema() {
        return configSchema;
    }

    public PluginConfigView setConfigSchema(Map<String, Object> configSchema) {
        this.configSchema = configSchema == null ? new LinkedHashMap<>() : new LinkedHashMap<>(configSchema);
        return this;
    }

    public Map<String, Object> getDefaultConfig() {
        return defaultConfig;
    }

    public PluginConfigView setDefaultConfig(Map<String, Object> defaultConfig) {
        this.defaultConfig = defaultConfig == null ? new LinkedHashMap<>() : new LinkedHashMap<>(defaultConfig);
        return this;
    }

    public Map<String, Object> getConfig() {
        return config;
    }

    public PluginConfigView setConfig(Map<String, Object> config) {
        this.config = config == null ? new LinkedHashMap<>() : new LinkedHashMap<>(config);
        return this;
    }
}
