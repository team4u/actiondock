package org.team4u.actiondock.web.sharedstate;

import java.time.LocalDateTime;

/**
 * 共享状态列表项视图。
 *
 * @author jay.wu
 */
public class SharedStateSummaryView {
    private String namespace;
    private String key;
    private boolean secret;
    private Long version;
    private LocalDateTime expiresAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private String lastWriterScriptId;
    private String lastWriterExecutionId;

    public String getNamespace() {
        return namespace;
    }

    public SharedStateSummaryView setNamespace(String namespace) {
        this.namespace = namespace;
        return this;
    }

    public String getKey() {
        return key;
    }

    public SharedStateSummaryView setKey(String key) {
        this.key = key;
        return this;
    }

    public boolean isSecret() {
        return secret;
    }

    public SharedStateSummaryView setSecret(boolean secret) {
        this.secret = secret;
        return this;
    }

    public Long getVersion() {
        return version;
    }

    public SharedStateSummaryView setVersion(Long version) {
        this.version = version;
        return this;
    }

    public LocalDateTime getExpiresAt() {
        return expiresAt;
    }

    public SharedStateSummaryView setExpiresAt(LocalDateTime expiresAt) {
        this.expiresAt = expiresAt;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public SharedStateSummaryView setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public SharedStateSummaryView setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }

    public String getLastWriterScriptId() {
        return lastWriterScriptId;
    }

    public SharedStateSummaryView setLastWriterScriptId(String lastWriterScriptId) {
        this.lastWriterScriptId = lastWriterScriptId;
        return this;
    }

    public String getLastWriterExecutionId() {
        return lastWriterExecutionId;
    }

    public SharedStateSummaryView setLastWriterExecutionId(String lastWriterExecutionId) {
        this.lastWriterExecutionId = lastWriterExecutionId;
        return this;
    }
}
