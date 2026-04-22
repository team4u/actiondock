package org.team4u.scriptflow.domain.model;

import java.time.LocalDateTime;

public class ExecutionLogEntry {
    private ExecutionLogLevel level = ExecutionLogLevel.INFO;
    private String message;
    private LocalDateTime createdAt;

    public ExecutionLogLevel getLevel() {
        return level;
    }

    public ExecutionLogEntry setLevel(ExecutionLogLevel level) {
        this.level = level == null ? ExecutionLogLevel.INFO : level;
        return this;
    }

    public String getMessage() {
        return message;
    }

    public ExecutionLogEntry setMessage(String message) {
        this.message = message;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public ExecutionLogEntry setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }
}
