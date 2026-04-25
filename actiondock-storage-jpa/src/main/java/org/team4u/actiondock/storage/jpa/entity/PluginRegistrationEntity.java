package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 插件注册 JPA 实体，对应 plugin_registration 表。
 *
 * @author jay.wu
 */
@Entity
@Table(name = "plugin_registration")
public class PluginRegistrationEntity {
    @Id
    private String pluginId;

    @Column(nullable = false)
    private String name;

    @Lob
    private String description;

    private String version;

    @Column(nullable = false)
    private String fileName;

    private String repositoryId;

    private String repositoryPluginId;

    private String repositoryVersion;

    @Lob
    private String configSchemaJson;

    @Lob
    private String defaultConfigJson;

    @Lob
    private String actionsJson;

    @Column(nullable = false)
    private boolean enabled;

    private LocalDateTime installedAt;
    private LocalDateTime updatedAt;

    public String getPluginId() {
        return pluginId;
    }

    public void setPluginId(String pluginId) {
        this.pluginId = pluginId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getVersion() {
        return version;
    }

    public void setVersion(String version) {
        this.version = version;
    }

    public String getFileName() {
        return fileName;
    }

    public void setFileName(String fileName) {
        this.fileName = fileName;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public void setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
    }

    public String getRepositoryPluginId() {
        return repositoryPluginId;
    }

    public void setRepositoryPluginId(String repositoryPluginId) {
        this.repositoryPluginId = repositoryPluginId;
    }

    public String getRepositoryVersion() {
        return repositoryVersion;
    }

    public void setRepositoryVersion(String repositoryVersion) {
        this.repositoryVersion = repositoryVersion;
    }

    public String getConfigSchemaJson() {
        return configSchemaJson;
    }

    public void setConfigSchemaJson(String configSchemaJson) {
        this.configSchemaJson = configSchemaJson;
    }

    public String getDefaultConfigJson() {
        return defaultConfigJson;
    }

    public void setDefaultConfigJson(String defaultConfigJson) {
        this.defaultConfigJson = defaultConfigJson;
    }

    public String getActionsJson() {
        return actionsJson;
    }

    public void setActionsJson(String actionsJson) {
        this.actionsJson = actionsJson;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public LocalDateTime getInstalledAt() {
        return installedAt;
    }

    public void setInstalledAt(LocalDateTime installedAt) {
        this.installedAt = installedAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }
}
