package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "event_record", indexes = {
        @Index(name = "idx_event_record_source_created", columnList = "sourceId, createdAt"),
        @Index(name = "idx_event_record_status", columnList = "status")
})
public class EventRecordEntity {
    @Id
    private String id;

    @Column(nullable = false)
    private String sourceId;

    @Column(nullable = false)
    private String sourceKey;

    @Column(nullable = false)
    private String status;

    private String eventType;
    private String externalEventId;
    private String actor;
    private String subject;

    @Lob
    private String rawHeadersJson;

    @Lob
    private String rawQueryJson;

    @Lob
    private String rawBodyJson;

    @Lob
    private String normalizedEventJson;

    @Lob
    private String errorMessage;

    private LocalDateTime createdAt;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getSourceId() {
        return sourceId;
    }

    public void setSourceId(String sourceId) {
        this.sourceId = sourceId;
    }

    public String getSourceKey() {
        return sourceKey;
    }

    public void setSourceKey(String sourceKey) {
        this.sourceKey = sourceKey;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getEventType() {
        return eventType;
    }

    public void setEventType(String eventType) {
        this.eventType = eventType;
    }

    public String getExternalEventId() {
        return externalEventId;
    }

    public void setExternalEventId(String externalEventId) {
        this.externalEventId = externalEventId;
    }

    public String getActor() {
        return actor;
    }

    public void setActor(String actor) {
        this.actor = actor;
    }

    public String getSubject() {
        return subject;
    }

    public void setSubject(String subject) {
        this.subject = subject;
    }

    public String getRawHeadersJson() {
        return rawHeadersJson;
    }

    public void setRawHeadersJson(String rawHeadersJson) {
        this.rawHeadersJson = rawHeadersJson;
    }

    public String getRawQueryJson() {
        return rawQueryJson;
    }

    public void setRawQueryJson(String rawQueryJson) {
        this.rawQueryJson = rawQueryJson;
    }

    public String getRawBodyJson() {
        return rawBodyJson;
    }

    public void setRawBodyJson(String rawBodyJson) {
        this.rawBodyJson = rawBodyJson;
    }

    public String getNormalizedEventJson() {
        return normalizedEventJson;
    }

    public void setNormalizedEventJson(String normalizedEventJson) {
        this.normalizedEventJson = normalizedEventJson;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public void setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }
}
