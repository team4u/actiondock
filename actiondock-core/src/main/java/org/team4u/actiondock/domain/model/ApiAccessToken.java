package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;

/**
 * 服务端 API 访问令牌。
 *
 * @author jay.wu
 */
public class ApiAccessToken {
    private String id;
    private String name;
    private String tokenHash;
    private String tokenPreview;
    private boolean enabled = true;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private LocalDateTime lastUsedAt;

    public String getId() {
        return id;
    }

    public ApiAccessToken setId(String id) {
        this.id = id;
        return this;
    }

    public String getName() {
        return name;
    }

    public ApiAccessToken setName(String name) {
        this.name = name;
        return this;
    }

    public String getTokenHash() {
        return tokenHash;
    }

    public ApiAccessToken setTokenHash(String tokenHash) {
        this.tokenHash = tokenHash;
        return this;
    }

    public String getTokenPreview() {
        return tokenPreview;
    }

    public ApiAccessToken setTokenPreview(String tokenPreview) {
        this.tokenPreview = tokenPreview;
        return this;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public ApiAccessToken setEnabled(boolean enabled) {
        this.enabled = enabled;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public ApiAccessToken setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public ApiAccessToken setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }

    public LocalDateTime getLastUsedAt() {
        return lastUsedAt;
    }

    public ApiAccessToken setLastUsedAt(LocalDateTime lastUsedAt) {
        this.lastUsedAt = lastUsedAt;
        return this;
    }
}
