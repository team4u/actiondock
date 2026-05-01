package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "event_dispatch", indexes = {
        @Index(name = "idx_event_dispatch_event_id", columnList = "eventId"),
        @Index(name = "idx_event_dispatch_trigger_id", columnList = "triggerId"),
        @Index(name = "idx_event_dispatch_trigger_key", columnList = "triggerId, idempotencyKey", unique = true)
})
public class EventDispatchEntity {
    @Id
    private String id;

    @Column(nullable = false)
    private String eventId;

    @Column(nullable = false)
    private String sourceId;

    @Column(nullable = false)
    private String triggerId;

    @Column(nullable = false)
    private String targetScriptId;

    @Column(nullable = false)
    private String status;

    private Boolean filterMatched;
    private String idempotencyKey;

    @Lob
    private String mappedInputJson;

    private String executionId;
    private String executionStatus;

    @Lob
    private String errorMessage;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getEventId() {
        return eventId;
    }

    public void setEventId(String eventId) {
        this.eventId = eventId;
    }

    public String getSourceId() {
        return sourceId;
    }

    public void setSourceId(String sourceId) {
        this.sourceId = sourceId;
    }

    public String getTriggerId() {
        return triggerId;
    }

    public void setTriggerId(String triggerId) {
        this.triggerId = triggerId;
    }

    public String getTargetScriptId() {
        return targetScriptId;
    }

    public void setTargetScriptId(String targetScriptId) {
        this.targetScriptId = targetScriptId;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Boolean getFilterMatched() {
        return filterMatched;
    }

    public void setFilterMatched(Boolean filterMatched) {
        this.filterMatched = filterMatched;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public void setIdempotencyKey(String idempotencyKey) {
        this.idempotencyKey = idempotencyKey;
    }

    public String getMappedInputJson() {
        return mappedInputJson;
    }

    public void setMappedInputJson(String mappedInputJson) {
        this.mappedInputJson = mappedInputJson;
    }

    public String getExecutionId() {
        return executionId;
    }

    public void setExecutionId(String executionId) {
        this.executionId = executionId;
    }

    public String getExecutionStatus() {
        return executionStatus;
    }

    public void setExecutionStatus(String executionStatus) {
        this.executionStatus = executionStatus;
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

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }
}
