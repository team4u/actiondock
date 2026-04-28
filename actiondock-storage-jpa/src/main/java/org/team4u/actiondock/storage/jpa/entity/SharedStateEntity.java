package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 通用共享状态实体。
 *
 * @author jay.wu
 */
@Entity
@Table(
        name = "shared_state_entry",
        indexes = {
                @Index(name = "idx_shared_state_namespace", columnList = "state_namespace"),
                @Index(name = "idx_shared_state_expires_at", columnList = "expires_at"),
                @Index(name = "idx_shared_state_namespace_expires", columnList = "state_namespace, expires_at")
        }
)
public class SharedStateEntity {
    @Id
    private String id;

    @Column(name = "state_namespace", nullable = false)
    private String namespace;

    @Column(name = "state_key", nullable = false)
    private String entryKey;

    @Lob
    @Column(name = "value_json")
    private String valueJson;

    private boolean secret;
    private Long versionValue;
    private LocalDateTime expiresAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private String lastWriterScriptId;
    private String lastWriterExecutionId;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getNamespace() {
        return namespace;
    }

    public void setNamespace(String namespace) {
        this.namespace = namespace;
    }

    public String getEntryKey() {
        return entryKey;
    }

    public void setEntryKey(String entryKey) {
        this.entryKey = entryKey;
    }

    public String getValueJson() {
        return valueJson;
    }

    public void setValueJson(String valueJson) {
        this.valueJson = valueJson;
    }

    public boolean isSecret() {
        return secret;
    }

    public void setSecret(boolean secret) {
        this.secret = secret;
    }

    public Long getVersionValue() {
        return versionValue;
    }

    public void setVersionValue(Long versionValue) {
        this.versionValue = versionValue;
    }

    public LocalDateTime getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(LocalDateTime expiresAt) {
        this.expiresAt = expiresAt;
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

    public String getLastWriterScriptId() {
        return lastWriterScriptId;
    }

    public void setLastWriterScriptId(String lastWriterScriptId) {
        this.lastWriterScriptId = lastWriterScriptId;
    }

    public String getLastWriterExecutionId() {
        return lastWriterExecutionId;
    }

    public void setLastWriterExecutionId(String lastWriterExecutionId) {
        this.lastWriterExecutionId = lastWriterExecutionId;
    }
}
