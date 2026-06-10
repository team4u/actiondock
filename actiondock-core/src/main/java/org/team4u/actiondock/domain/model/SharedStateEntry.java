package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;

/**
 * 通用共享状态条目。
 *
 * @author jay.wu
 */
public class SharedStateEntry {
    private String namespace;
    private String key;
    private Object value;
    private boolean secret;
    private Long version = 1L;
    private LocalDateTime expiresAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private String lastWriterScriptId;
    private String lastWriterExecutionId;

    public String getNamespace() {
        return namespace;
    }

    public SharedStateEntry setNamespace(String namespace) {
        this.namespace = namespace;
        return this;
    }

    public String getKey() {
        return key;
    }

    public SharedStateEntry setKey(String key) {
        this.key = key;
        return this;
    }

    public Object getValue() {
        return value;
    }

    public SharedStateEntry setValue(Object value) {
        this.value = value;
        return this;
    }

    public boolean isSecret() {
        return secret;
    }

    public SharedStateEntry setSecret(boolean secret) {
        this.secret = secret;
        return this;
    }

    public Long getVersion() {
        return version;
    }

    public SharedStateEntry setVersion(Long version) {
        this.version = version;
        return this;
    }

    public LocalDateTime getExpiresAt() {
        return expiresAt;
    }

    public SharedStateEntry setExpiresAt(LocalDateTime expiresAt) {
        this.expiresAt = expiresAt;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public SharedStateEntry setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public SharedStateEntry setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }

    public String getLastWriterScriptId() {
        return lastWriterScriptId;
    }

    public SharedStateEntry setLastWriterScriptId(String lastWriterScriptId) {
        this.lastWriterScriptId = lastWriterScriptId;
        return this;
    }

    public String getLastWriterExecutionId() {
        return lastWriterExecutionId;
    }

    public SharedStateEntry setLastWriterExecutionId(String lastWriterExecutionId) {
        this.lastWriterExecutionId = lastWriterExecutionId;
        return this;
    }

    public boolean isExpiredAt(LocalDateTime now) {
        return expiresAt != null && now != null && !expiresAt.isAfter(now);
    }

    public SharedStateEntry copy() {
        return new SharedStateEntry()
                .setNamespace(namespace)
                .setKey(key)
                .setValue(value)
                .setSecret(secret)
                .setVersion(version)
                .setExpiresAt(expiresAt)
                .setCreatedAt(createdAt)
                .setUpdatedAt(updatedAt)
                .setLastWriterScriptId(lastWriterScriptId)
                .setLastWriterExecutionId(lastWriterExecutionId);
    }
}
