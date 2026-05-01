package org.team4u.actiondock.domain.model;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class ProcessorResult {
    private boolean success;
    private Map<String, Object> output = Map.of();
    private String errorMessage;
    private List<ExecutionLogEntry> logs = new ArrayList<>();
    private Long durationMs;

    public boolean isSuccess() {
        return success;
    }

    public ProcessorResult setSuccess(boolean success) {
        this.success = success;
        return this;
    }

    public Map<String, Object> getOutput() {
        return SchemaValueCopier.copyMap(output);
    }

    public ProcessorResult setOutput(Map<String, Object> output) {
        this.output = SchemaValueCopier.copyMap(output);
        return this;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public ProcessorResult setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
        return this;
    }

    public List<ExecutionLogEntry> getLogs() {
        return List.copyOf(logs);
    }

    public ProcessorResult setLogs(List<ExecutionLogEntry> logs) {
        this.logs = logs == null ? new ArrayList<>() : new ArrayList<>(logs);
        return this;
    }

    public Long getDurationMs() {
        return durationMs;
    }

    public ProcessorResult setDurationMs(Long durationMs) {
        this.durationMs = durationMs;
        return this;
    }
}
