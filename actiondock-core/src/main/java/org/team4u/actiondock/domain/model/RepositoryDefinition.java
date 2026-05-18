package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;

/**
 * 工具仓库定义。
 *
 * @author jay.wu
 */
public class RepositoryDefinition {

    private String id;
    private String name;
    private String type;
    private String purpose;
    private String url;
    private String branch;
    private boolean enabled = true;
    private String trustLevel;
    private String description;
    private LocalDateTime lastSyncedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public RepositoryDefinition setId(String id) {
        this.id = id;
        return this;
    }

    public String getName() {
        return name;
    }

    public RepositoryDefinition setName(String name) {
        this.name = name;
        return this;
    }

    public String getType() {
        return type;
    }

    public RepositoryDefinition setType(String type) {
        this.type = type;
        return this;
    }

    public String getPurpose() {
        return purpose;
    }

    public RepositoryDefinition setPurpose(String purpose) {
        this.purpose = purpose;
        return this;
    }

    public String getUrl() {
        return url;
    }

    public RepositoryDefinition setUrl(String url) {
        this.url = url;
        return this;
    }

    public String getBranch() {
        return branch;
    }

    public RepositoryDefinition setBranch(String branch) {
        this.branch = branch;
        return this;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public RepositoryDefinition setEnabled(boolean enabled) {
        this.enabled = enabled;
        return this;
    }

    public String getTrustLevel() {
        return trustLevel;
    }

    public RepositoryDefinition setTrustLevel(String trustLevel) {
        this.trustLevel = trustLevel;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public RepositoryDefinition setDescription(String description) {
        this.description = description;
        return this;
    }

    public LocalDateTime getLastSyncedAt() {
        return lastSyncedAt;
    }

    public RepositoryDefinition setLastSyncedAt(LocalDateTime lastSyncedAt) {
        this.lastSyncedAt = lastSyncedAt;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public RepositoryDefinition setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public RepositoryDefinition setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
