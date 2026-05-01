package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "event_trigger", indexes = {
        @Index(name = "idx_event_trigger_source_id", columnList = "sourceId"),
        @Index(name = "idx_event_trigger_enabled", columnList = "enabled")
})
public class EventTriggerEntity {
    @Id
    private String id;

    @Column(nullable = false)
    private String name;

    @Lob
    private String description;

    @Column(nullable = false)
    private boolean enabled;

    @Column(nullable = false)
    private String sourceId;

    @Column(nullable = false)
    private String targetScriptId;

    @Lob
    private String filterProcessorJson;

    @Lob
    private String idempotencyProcessorJson;

    @Lob
    private String inputProcessorJson;

    @Column(nullable = false)
    private String submitMode;

    @Column(nullable = false)
    private String responseView;

    private String lastEventId;
    private LocalDateTime lastTriggeredAt;
    private String lastExecutionId;
    private String lastExecutionStatus;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
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

    public String getSourceId() {
        return sourceId;
    }

    public void setSourceId(String sourceId) {
        this.sourceId = sourceId;
    }

    public String getTargetScriptId() {
        return targetScriptId;
    }

    public void setTargetScriptId(String targetScriptId) {
        this.targetScriptId = targetScriptId;
    }

    public String getFilterProcessorJson() {
        return filterProcessorJson;
    }

    public void setFilterProcessorJson(String filterProcessorJson) {
        this.filterProcessorJson = filterProcessorJson;
    }

    public String getIdempotencyProcessorJson() {
        return idempotencyProcessorJson;
    }

    public void setIdempotencyProcessorJson(String idempotencyProcessorJson) {
        this.idempotencyProcessorJson = idempotencyProcessorJson;
    }

    public String getInputProcessorJson() {
        return inputProcessorJson;
    }

    public void setInputProcessorJson(String inputProcessorJson) {
        this.inputProcessorJson = inputProcessorJson;
    }

    public String getSubmitMode() {
        return submitMode;
    }

    public void setSubmitMode(String submitMode) {
        this.submitMode = submitMode;
    }

    public String getResponseView() {
        return responseView;
    }

    public void setResponseView(String responseView) {
        this.responseView = responseView;
    }

    public String getLastEventId() {
        return lastEventId;
    }

    public void setLastEventId(String lastEventId) {
        this.lastEventId = lastEventId;
    }

    public LocalDateTime getLastTriggeredAt() {
        return lastTriggeredAt;
    }

    public void setLastTriggeredAt(LocalDateTime lastTriggeredAt) {
        this.lastTriggeredAt = lastTriggeredAt;
    }

    public String getLastExecutionId() {
        return lastExecutionId;
    }

    public void setLastExecutionId(String lastExecutionId) {
        this.lastExecutionId = lastExecutionId;
    }

    public String getLastExecutionStatus() {
        return lastExecutionStatus;
    }

    public void setLastExecutionStatus(String lastExecutionStatus) {
        this.lastExecutionStatus = lastExecutionStatus;
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
