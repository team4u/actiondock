package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;

public class EventTrigger {

    public static final String DEFAULT_RESPONSE_VIEW = "RESULT";

    private String id;
    private String name;
    private String description;
    private boolean enabled = true;
    private String sourceId;
    private String targetScriptId;
    private ProcessorDefinition filterProcessor;
    private ProcessorDefinition idempotencyProcessor;
    private ProcessorDefinition inputProcessor;
    private SubmitMode submitMode = SubmitMode.ASYNC;
    private String responseView = DEFAULT_RESPONSE_VIEW;
    private String lastEventId;
    private LocalDateTime lastTriggeredAt;
    private String lastExecutionId;
    private ExecutionStatus lastExecutionStatus;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public EventTrigger setId(String id) {
        this.id = id;
        return this;
    }

    public String getName() {
        return name;
    }

    public EventTrigger setName(String name) {
        this.name = name;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public EventTrigger setDescription(String description) {
        this.description = description;
        return this;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public EventTrigger setEnabled(boolean enabled) {
        this.enabled = enabled;
        return this;
    }

    public String getSourceId() {
        return sourceId;
    }

    public EventTrigger setSourceId(String sourceId) {
        this.sourceId = sourceId;
        return this;
    }

    public String getTargetScriptId() {
        return targetScriptId;
    }

    public EventTrigger setTargetScriptId(String targetScriptId) {
        this.targetScriptId = targetScriptId;
        return this;
    }

    public ProcessorDefinition getFilterProcessor() {
        return filterProcessor;
    }

    public EventTrigger setFilterProcessor(ProcessorDefinition filterProcessor) {
        this.filterProcessor = filterProcessor;
        return this;
    }

    public ProcessorDefinition getIdempotencyProcessor() {
        return idempotencyProcessor;
    }

    public EventTrigger setIdempotencyProcessor(ProcessorDefinition idempotencyProcessor) {
        this.idempotencyProcessor = idempotencyProcessor;
        return this;
    }

    public ProcessorDefinition getInputProcessor() {
        return inputProcessor;
    }

    public EventTrigger setInputProcessor(ProcessorDefinition inputProcessor) {
        this.inputProcessor = inputProcessor;
        return this;
    }

    public SubmitMode getSubmitMode() {
        return submitMode;
    }

    public EventTrigger setSubmitMode(SubmitMode submitMode) {
        this.submitMode = submitMode == null ? SubmitMode.ASYNC : submitMode;
        return this;
    }

    public String getResponseView() {
        return responseView;
    }

    public EventTrigger setResponseView(String responseView) {
        this.responseView = responseView == null || responseView.isBlank() ? DEFAULT_RESPONSE_VIEW : responseView;
        return this;
    }

    public String getLastEventId() {
        return lastEventId;
    }

    public EventTrigger setLastEventId(String lastEventId) {
        this.lastEventId = lastEventId;
        return this;
    }

    public LocalDateTime getLastTriggeredAt() {
        return lastTriggeredAt;
    }

    public EventTrigger setLastTriggeredAt(LocalDateTime lastTriggeredAt) {
        this.lastTriggeredAt = lastTriggeredAt;
        return this;
    }

    public String getLastExecutionId() {
        return lastExecutionId;
    }

    public EventTrigger setLastExecutionId(String lastExecutionId) {
        this.lastExecutionId = lastExecutionId;
        return this;
    }

    public ExecutionStatus getLastExecutionStatus() {
        return lastExecutionStatus;
    }

    public EventTrigger setLastExecutionStatus(ExecutionStatus lastExecutionStatus) {
        this.lastExecutionStatus = lastExecutionStatus;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public EventTrigger setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public EventTrigger setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
