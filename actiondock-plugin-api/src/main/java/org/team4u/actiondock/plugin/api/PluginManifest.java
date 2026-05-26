package org.team4u.actiondock.plugin.api;

import com.fasterxml.jackson.annotation.JsonAlias;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 插件清单，描述插件的元信息、配置模式和动作列表。
 * <p>
 * 每个插件的清单以 JSON 文件形式存储在 classpath 中。
 *
 * @author jay.wu
 */
public class PluginManifest {
    @JsonAlias("id")
    private String pluginId;
    private String name;
    private String description;
    private String version;
    private Map<String, Object> configSchema = new LinkedHashMap<>();
    private Map<String, Object> defaultConfig = new LinkedHashMap<>();
    private List<PluginActionManifest> actions = new ArrayList<>();

    public String getPluginId() {
        return pluginId;
    }

    public PluginManifest setPluginId(String pluginId) {
        this.pluginId = pluginId;
        return this;
    }

    public String getName() {
        return name;
    }

    public PluginManifest setName(String name) {
        this.name = name;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public PluginManifest setDescription(String description) {
        this.description = description;
        return this;
    }

    public String getVersion() {
        return version;
    }

    public PluginManifest setVersion(String version) {
        this.version = version;
        return this;
    }

    public Map<String, Object> getConfigSchema() {
        return configSchema;
    }

    public PluginManifest setConfigSchema(Map<String, Object> configSchema) {
        this.configSchema = configSchema == null ? new LinkedHashMap<>() : new LinkedHashMap<>(configSchema);
        return this;
    }

    public Map<String, Object> getDefaultConfig() {
        return defaultConfig;
    }

    public PluginManifest setDefaultConfig(Map<String, Object> defaultConfig) {
        this.defaultConfig = defaultConfig == null ? new LinkedHashMap<>() : new LinkedHashMap<>(defaultConfig);
        return this;
    }

    public List<PluginActionManifest> getActions() {
        return actions;
    }

    public PluginManifest setActions(List<PluginActionManifest> actions) {
        this.actions = actions == null ? new ArrayList<>() : new ArrayList<>(actions);
        return this;
    }
}
