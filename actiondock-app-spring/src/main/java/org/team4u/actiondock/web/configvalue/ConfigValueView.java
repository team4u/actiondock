package org.team4u.actiondock.web.configvalue;

import java.time.LocalDateTime;

/**
 * 配置值视图。
 *
 * @author jay.wu
 */
public class ConfigValueView {
    private String key;
    private String value;
    private String valueMasked;
    private boolean hasValue;
    private String description;
    private boolean secret;
    private String repositoryId;
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

    public ConfigValueView setKey(String key) {
        this.key = key;
        return this;
    }

    public String getValue() {
        return value;
    }

    public ConfigValueView setValue(String value) {
        this.value = value;
        return this;
    }

    public String getValueMasked() {
        return valueMasked;
    }

    public ConfigValueView setValueMasked(String valueMasked) {
        this.valueMasked = valueMasked;
        return this;
    }

    public boolean isHasValue() {
        return hasValue;
    }

    public ConfigValueView setHasValue(boolean hasValue) {
        this.hasValue = hasValue;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public ConfigValueView setDescription(String description) {
        this.description = description;
        return this;
    }

    public boolean isSecret() {
        return secret;
    }

    public ConfigValueView setSecret(boolean secret) {
        this.secret = secret;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public ConfigValueView setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getRepositoryScriptId() {
        return repositoryScriptId;
    }

    public ConfigValueView setRepositoryScriptId(String repositoryScriptId) {
        this.repositoryScriptId = repositoryScriptId;
        return this;
    }

    public String getRepositoryVersion() {
        return repositoryVersion;
    }

    public ConfigValueView setRepositoryVersion(String repositoryVersion) {
        this.repositoryVersion = repositoryVersion;
        return this;
    }

    public String getPublishMode() {
        return publishMode;
    }

    public ConfigValueView setPublishMode(String publishMode) {
        this.publishMode = publishMode;
        return this;
    }

    public boolean isManaged() {
        return managed;
    }

    public ConfigValueView setManaged(boolean managed) {
        this.managed = managed;
        return this;
    }

    public boolean isOverridden() {
        return overridden;
    }

    public ConfigValueView setOverridden(boolean overridden) {
        this.overridden = overridden;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public ConfigValueView setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public ConfigValueView setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
