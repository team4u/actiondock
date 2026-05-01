package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

public class EventDispatchRecord {
    private String id;
    private String eventId;
    private String sourceId;
    private String triggerId;
    private String targetScriptId;
    private EventDispatchStatus status;
    private Boolean filterMatched;
    private String idempotencyKey;
    private Map<String, Object> mappedInput = new LinkedHashMap<>();
    private String executionId;
    private ExecutionStatus executionStatus;
    private String errorMessage;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public EventDispatchRecord setId(String id) {
        this.id = id;
        return this;
    }

    public String getEventId() {
        return eventId;
    }

    public EventDispatchRecord setEventId(String eventId) {
        this.eventId = eventId;
        return this;
    }

    public String getSourceId() {
        return sourceId;
    }

    public EventDispatchRecord setSourceId(String sourceId) {
        this.sourceId = sourceId;
        return this;
    }

    public String getTriggerId() {
        return triggerId;
    }

    public EventDispatchRecord setTriggerId(String triggerId) {
        this.triggerId = triggerId;
        return this;
    }

    public String getTargetScriptId() {
        return targetScriptId;
    }

    public EventDispatchRecord setTargetScriptId(String targetScriptId) {
        this.targetScriptId = targetScriptId;
        return this;
    }

    public EventDispatchStatus getStatus() {
        return status;
    }

    public EventDispatchRecord setStatus(EventDispatchStatus status) {
        this.status = status;
        return this;
    }

    public Boolean getFilterMatched() {
        return filterMatched;
    }

    public EventDispatchRecord setFilterMatched(Boolean filterMatched) {
        this.filterMatched = filterMatched;
        return this;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public EventDispatchRecord setIdempotencyKey(String idempotencyKey) {
        this.idempotencyKey = idempotencyKey;
        return this;
    }

    public Map<String, Object> getMappedInput() {
        return SchemaValueCopier.copyMap(mappedInput);
    }

    public EventDispatchRecord setMappedInput(Map<String, Object> mappedInput) {
        this.mappedInput = SchemaValueCopier.copyMap(mappedInput);
        return this;
    }

    public String getExecutionId() {
        return executionId;
    }

    public EventDispatchRecord setExecutionId(String executionId) {
        this.executionId = executionId;
        return this;
    }

    public ExecutionStatus getExecutionStatus() {
        return executionStatus;
    }

    public EventDispatchRecord setExecutionStatus(ExecutionStatus executionStatus) {
        this.executionStatus = executionStatus;
        return this;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public EventDispatchRecord setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public EventDispatchRecord setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public EventDispatchRecord setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
