package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "webhook", indexes = {
        @Index(name = "idx_webhook_key", columnList = "webhookKey", unique = true),
        @Index(name = "idx_webhook_enabled", columnList = "enabled")
})
public class WebhookEntity {
    @Id
    private String id;

    @Column(nullable = false, unique = true)
    private String webhookKey;

    @Column(nullable = false)
    private String name;

    @Lob
    private String description;

    private String scope;
    private String repositoryId;
    private String repositoryWebhookId;
    private String repositoryVersion;
    private String sourcePath;
    private String sourceCommit;
    private String sourceDigest;
    private LocalDateTime sourceSyncedAt;
    private boolean dirty;
    private boolean editable;

    @Column(nullable = false)
    private boolean enabled;

    @Lob
    private String transportJson;

    private String webhookScriptId;

    @Lob
    @Column(name = "sample_request_json")
    private String sampleRequestJson;

    private LocalDateTime lastReceivedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getWebhookKey() {
        return webhookKey;
    }

    public void setWebhookKey(String webhookKey) {
        this.webhookKey = webhookKey;
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

    public String getScope() {
        return scope;
    }

    public void setScope(String scope) {
        this.scope = scope;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public void setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
    }

    public String getRepositoryWebhookId() {
        return repositoryWebhookId;
    }

    public void setRepositoryWebhookId(String repositoryWebhookId) {
        this.repositoryWebhookId = repositoryWebhookId;
    }

    public String getRepositoryVersion() {
        return repositoryVersion;
    }

    public void setRepositoryVersion(String repositoryVersion) {
        this.repositoryVersion = repositoryVersion;
    }

    public String getSourcePath() {
        return sourcePath;
    }

    public void setSourcePath(String sourcePath) {
        this.sourcePath = sourcePath;
    }

    public String getSourceCommit() {
        return sourceCommit;
    }

    public void setSourceCommit(String sourceCommit) {
        this.sourceCommit = sourceCommit;
    }

    public String getSourceDigest() {
        return sourceDigest;
    }

    public void setSourceDigest(String sourceDigest) {
        this.sourceDigest = sourceDigest;
    }

    public LocalDateTime getSourceSyncedAt() {
        return sourceSyncedAt;
    }

    public void setSourceSyncedAt(LocalDateTime sourceSyncedAt) {
        this.sourceSyncedAt = sourceSyncedAt;
    }

    public boolean isDirty() {
        return dirty;
    }

    public void setDirty(boolean dirty) {
        this.dirty = dirty;
    }

    public boolean isEditable() {
        return editable;
    }

    public void setEditable(boolean editable) {
        this.editable = editable;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getTransportJson() {
        return transportJson;
    }

    public void setTransportJson(String transportJson) {
        this.transportJson = transportJson;
    }

    public String getWebhookScriptId() {
        return webhookScriptId;
    }

    public void setWebhookScriptId(String webhookScriptId) {
        this.webhookScriptId = webhookScriptId;
    }

    public String getSampleRequestJson() {
        return sampleRequestJson;
    }

    public void setSampleRequestJson(String sampleRequestJson) {
        this.sampleRequestJson = sampleRequestJson;
    }

    public LocalDateTime getLastReceivedAt() {
        return lastReceivedAt;
    }

    public void setLastReceivedAt(LocalDateTime lastReceivedAt) {
        this.lastReceivedAt = lastReceivedAt;
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
