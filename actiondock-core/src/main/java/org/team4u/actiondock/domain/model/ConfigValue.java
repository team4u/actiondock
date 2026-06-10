package org.team4u.actiondock.domain.model;

import com.fasterxml.jackson.annotation.JsonAlias;

import java.time.LocalDateTime;

/**
 * 平台级配置值定义。
 * <p>
 * 使用 key/value 形式保存可复用的全局字符串配置，可被脚本、插件和调度输入引用。
 *
 * @author jay.wu
 */
public class ConfigValue {
    private String key;
    private String value = "";
    private String description;
    private boolean secret;
    private String repositoryId;
    @JsonAlias("repositoryToolId")
    private String repositoryScriptId;
    private String repositoryVersion;
    private String publishMode;
    private boolean managed;
    private boolean overridden;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getKey() {
        return key;
    }

    public ConfigValue setKey(String key) {
        this.key = key;
        return this;
    }

    public String getValue() {
        return value;
    }

    public ConfigValue setValue(String value) {
        this.value = value == null ? "" : value;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public ConfigValue setDescription(String description) {
        this.description = description;
        return this;
    }

    public boolean isSecret() {
        return secret;
    }

    public ConfigValue setSecret(boolean secret) {
        this.secret = secret;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public ConfigValue setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getRepositoryScriptId() {
        return repositoryScriptId;
    }

    public ConfigValue setRepositoryScriptId(String repositoryScriptId) {
        this.repositoryScriptId = repositoryScriptId;
        return this;
    }

    @Deprecated
    public ConfigValue setRepositoryToolId(String repositoryToolId) {
        return setRepositoryScriptId(repositoryToolId);
    }

    public String getRepositoryVersion() {
        return repositoryVersion;
    }

    public ConfigValue setRepositoryVersion(String repositoryVersion) {
        this.repositoryVersion = repositoryVersion;
        return this;
    }

    public String getPublishMode() {
        return publishMode;
    }

    public ConfigValue setPublishMode(String publishMode) {
        this.publishMode = publishMode;
        return this;
    }

    public boolean isManaged() {
        return managed;
    }

    public ConfigValue setManaged(boolean managed) {
        this.managed = managed;
        return this;
    }

    public boolean isOverridden() {
        return overridden;
    }

    public ConfigValue setOverridden(boolean overridden) {
        this.overridden = overridden;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public ConfigValue setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public ConfigValue setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }

    public ConfigValue copy() {
        return new ConfigValue()
                .setKey(key)
                .setValue(value)
                .setDescription(description)
                .setSecret(secret)
                .setRepositoryId(repositoryId)
                .setRepositoryScriptId(repositoryScriptId)
                .setRepositoryVersion(repositoryVersion)
                .setPublishMode(publishMode)
                .setManaged(managed)
                .setOverridden(overridden)
                .setCreatedAt(createdAt)
                .setUpdatedAt(updatedAt);
    }
}
