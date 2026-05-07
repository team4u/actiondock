package org.team4u.actiondock.web.accesstoken;

import java.time.LocalDateTime;

/**
 * 访问令牌视图。
 *
 * @author jay.wu
 */
public class AccessTokenView {
    private String id;
    private String name;
    private String tokenPreview;
    private boolean enabled;
    private String tokenValue;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private LocalDateTime lastUsedAt;

    public String getId() {
        return id;
    }

    public AccessTokenView setId(String id) {
        this.id = id;
        return this;
    }

    public String getName() {
        return name;
    }

    public AccessTokenView setName(String name) {
        this.name = name;
        return this;
    }

    public String getTokenPreview() {
        return tokenPreview;
    }

    public AccessTokenView setTokenPreview(String tokenPreview) {
        this.tokenPreview = tokenPreview;
        return this;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public AccessTokenView setEnabled(boolean enabled) {
        this.enabled = enabled;
        return this;
    }

    public String getTokenValue() {
        return tokenValue;
    }

    public AccessTokenView setTokenValue(String tokenValue) {
        this.tokenValue = tokenValue;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public AccessTokenView setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public AccessTokenView setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }

    public LocalDateTime getLastUsedAt() {
        return lastUsedAt;
    }

    public AccessTokenView setLastUsedAt(LocalDateTime lastUsedAt) {
        this.lastUsedAt = lastUsedAt;
        return this;
    }
}
