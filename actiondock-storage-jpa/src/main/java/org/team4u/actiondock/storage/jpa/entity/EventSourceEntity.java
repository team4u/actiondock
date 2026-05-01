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
