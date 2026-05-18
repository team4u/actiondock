package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;

/**
 * 执行日志条目，记录脚本执行过程中产生的单条日志信息。
 *
 * @author jay.wu
 */
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
