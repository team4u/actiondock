package org.team4u.scriptflow.domain.model;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

public class ExecutionRecord {
    private String id;
    private String scriptId;
    private ExecutionStatus status = ExecutionStatus.PENDING;
    private SubmitMode submitMode = SubmitMode.SYNC;
    private Map<String, Object> input = new LinkedHashMap<>();
    private Map<String, Object> output = new LinkedHashMap<>();
    private String errorMessage;
    private LocalDateTime createdAt;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;

    public String getId() {
        return id;
    }

    public ExecutionRecord setId(String id) {
        this.id = id;
        return this;
    }

    public String getScriptId() {
        return scriptId;
    }

    public ExecutionRecord setScriptId(String scriptId) {
        this.scriptId = scriptId;
        return this;
    }

    public ExecutionStatus getStatus() {
        return status;
    }

    public ExecutionRecord setStatus(ExecutionStatus status) {
        this.status = status;
        return this;
    }

    public SubmitMode getSubmitMode() {
        return submitMode;
    }

    public ExecutionRecord setSubmitMode(SubmitMode submitMode) {
        this.submitMode = submitMode;
        return this;
    }

    public Map<String, Object> getInput() {
        return input;
    }

    public ExecutionRecord setInput(Map<String, Object> input) {
        this.input = input == null ? new LinkedHashMap<>() : input;
        return this;
    }

    public Map<String, Object> getOutput() {
        return output;
    }

    public ExecutionRecord setOutput(Map<String, Object> output) {
        this.output = output == null ? new LinkedHashMap<>() : output;
        return this;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public ExecutionRecord setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public ExecutionRecord setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getStartedAt() {
        return startedAt;
    }

    public ExecutionRecord setStartedAt(LocalDateTime startedAt) {
        this.startedAt = startedAt;
        return this;
    }

    public LocalDateTime getFinishedAt() {
        return finishedAt;
    }

    public ExecutionRecord setFinishedAt(LocalDateTime finishedAt) {
        this.finishedAt = finishedAt;
        return this;
    }
}
