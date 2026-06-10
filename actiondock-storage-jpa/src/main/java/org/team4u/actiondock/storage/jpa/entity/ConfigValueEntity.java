package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 全局配置值 JPA 实体，对应 config_value 表。
 *
 * @author jay.wu
 */
@Entity
@Table(name = "config_value", indexes = @Index(name = "idx_config_value_repository_id", columnList = "repositoryId"))
public class ConfigValueEntity {
    @Id
    @Column(name = "config_key", nullable = false)
    private String key;

    @Lob
    @Column(name = "config_value", nullable = false)
    private String value;

    private String description;
    private boolean secret;
    private String repositoryId;
    @Column(name = "repository_script_id")
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

    public void setKey(String key) {
        this.key = key;
    }

    public String getValue() {
        return value;
    }

    public void setValue(String value) {
        this.value = value;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public boolean isSecret() {
        return secret;
    }

    public void setSecret(boolean secret) {
        this.secret = secret;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public void setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
    }

    public String getRepositoryScriptId() {
        return repositoryScriptId;
    }

    public void setRepositoryScriptId(String repositoryScriptId) {
        this.repositoryScriptId = repositoryScriptId;
    }

    public String getRepositoryVersion() {
        return repositoryVersion;
    }

    public void setRepositoryVersion(String repositoryVersion) {
        this.repositoryVersion = repositoryVersion;
    }

    public String getPublishMode() {
        return publishMode;
    }

    public void setPublishMode(String publishMode) {
        this.publishMode = publishMode;
    }

    public boolean isManaged() {
        return managed;
    }

    public void setManaged(boolean managed) {
        this.managed = managed;
    }

    public boolean isOverridden() {
        return overridden;
    }

    public void setOverridden(boolean overridden) {
        this.overridden = overridden;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }
}
