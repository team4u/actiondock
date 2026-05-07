package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "event_source", indexes = {
        @Index(name = "idx_event_source_key", columnList = "sourceKey", unique = true),
        @Index(name = "idx_event_source_enabled", columnList = "enabled")
})
public class EventSourceEntity {
    @Id
    private String id;

    @Column(nullable = false, unique = true)
    private String sourceKey;

    @Column(nullable = false)
    private String name;

    @Lob
    private String description;

    private String scope;
    private String repositoryId;
    private String repositoryEventSourceId;
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

    @Lob
    private String authJson;

    @Lob
    private String normalizationProcessorJson;

    @Lob
    private String sampleContextJson;

    private LocalDateTime lastReceivedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getSourceKey() {
        return sourceKey;
    }

    public void setSourceKey(String sourceKey) {
        this.sourceKey = sourceKey;
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

    public String getRepositoryEventSourceId() {
        return repositoryEventSourceId;
    }

    public void setRepositoryEventSourceId(String repositoryEventSourceId) {
        this.repositoryEventSourceId = repositoryEventSourceId;
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

    public String getAuthJson() {
        return authJson;
    }

    public void setAuthJson(String authJson) {
        this.authJson = authJson;
    }

    public String getNormalizationProcessorJson() {
        return normalizationProcessorJson;
    }

    public void setNormalizationProcessorJson(String normalizationProcessorJson) {
        this.normalizationProcessorJson = normalizationProcessorJson;
    }

    public String getSampleContextJson() {
        return sampleContextJson;
    }

    public void setSampleContextJson(String sampleContextJson) {
        this.sampleContextJson = sampleContextJson;
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
