package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 插件注册信息，记录已安装插件的元数据。
 * <p>
 * 包含插件的基本信息、配置模式、可用动作以及启用状态。
 * 支持插件的动态安装、配置和启用/禁用管理。
 *
 * @author jay.wu
 */
public class PluginRegistration {
    private String pluginId;
    private String name;
    private String description;
    private String version;
    private String fileName;
    private String repositoryId;
    private String repositoryPluginId;
    private String repositoryVersion;
    private Map<String, Object> configSchema = new LinkedHashMap<>();
    private Map<String, Object> defaultConfig = new LinkedHashMap<>();
    private List<PluginActionMetadata> actions = new ArrayList<>();
    private boolean enabled;
    private LocalDateTime installedAt;
    private LocalDateTime updatedAt;

    public String getPluginId() {
        return pluginId;
    }

    public PluginRegistration setPluginId(String pluginId) {
        this.pluginId = pluginId;
        return this;
    }

    public String getName() {
        return name;
    }

    public PluginRegistration setName(String name) {
        this.name = name;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public PluginRegistration setDescription(String description) {
        this.description = description;
        return this;
    }

    public String getVersion() {
        return version;
    }

    public PluginRegistration setVersion(String version) {
        this.version = version;
        return this;
    }

    public String getFileName() {
        return fileName;
    }

    public PluginRegistration setFileName(String fileName) {
        this.fileName = fileName;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public PluginRegistration setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getRepositoryPluginId() {
        return repositoryPluginId;
    }

    public PluginRegistration setRepositoryPluginId(String repositoryPluginId) {
        this.repositoryPluginId = repositoryPluginId;
        return this;
    }

    public String getRepositoryVersion() {
        return repositoryVersion;
    }

    public PluginRegistration setRepositoryVersion(String repositoryVersion) {
        this.repositoryVersion = repositoryVersion;
        return this;
    }

    /**
     * 获取插件的配置模式。
     * <p>
     * 定义插件支持的可配置项及其类型约束。
     *
     * @return 配置模式映射
     */
    public Map<String, Object> getConfigSchema() {
        return Collections.unmodifiableMap(configSchema);
    }

    public PluginRegistration setConfigSchema(Map<String, Object> configSchema) {
        this.configSchema = configSchema == null ? new LinkedHashMap<>() : new LinkedHashMap<>(configSchema);
        return this;
    }

    /**
     * 获取插件的默认配置。
     *
     * @return 默认配置映射
     */
    public Map<String, Object> getDefaultConfig() {
        return Collections.unmodifiableMap(defaultConfig);
    }

    public PluginRegistration setDefaultConfig(Map<String, Object> defaultConfig) {
        this.defaultConfig = defaultConfig == null ? new LinkedHashMap<>() : new LinkedHashMap<>(defaultConfig);
        return this;
    }

    /**
     * 获取插件提供的动作列表。
     * <p>
     * 每个动作代表插件可执行的一个操作单元。
     *
     * @return 动作元数据列表
     */
    public List<PluginActionMetadata> getActions() {
        return Collections.unmodifiableList(actions);
    }

    public PluginRegistration setActions(List<PluginActionMetadata> actions) {
        this.actions = actions == null ? new ArrayList<>() : new ArrayList<>(actions);
        return this;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public PluginRegistration setEnabled(boolean enabled) {
        this.enabled = enabled;
        return this;
    }

    public LocalDateTime getInstalledAt() {
        return installedAt;
    }

    public PluginRegistration setInstalledAt(LocalDateTime installedAt) {
        this.installedAt = installedAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public PluginRegistration setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }

    public PluginRegistration copy() {
        return new PluginRegistration()
                .setPluginId(pluginId)
                .setName(name)
                .setDescription(description)
                .setVersion(version)
                .setFileName(fileName)
                .setRepositoryId(repositoryId)
                .setRepositoryPluginId(repositoryPluginId)
                .setRepositoryVersion(repositoryVersion)
                .setConfigSchema(configSchema)
                .setDefaultConfig(defaultConfig)
                .setActions(actions)
                .setEnabled(enabled)
                .setInstalledAt(installedAt)
                .setUpdatedAt(updatedAt);
    }
}
