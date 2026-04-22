package org.team4u.scriptflow.domain.model;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

public class ScriptSchedule {
    private String id;
    private String scriptId;
    private String name;
    private String cronExpression;
    private Map<String, Object> input = new LinkedHashMap<>();
    private boolean enabled = true;
    private LocalDateTime lastTriggeredAt;
    private String lastExecutionId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public ScriptSchedule setId(String id) {
        this.id = id;
        return this;
    }

    public String getScriptId() {
        return scriptId;
    }

    public ScriptSchedule setScriptId(String scriptId) {
        this.scriptId = scriptId;
        return this;
    }

    public String getName() {
        return name;
    }

    public ScriptSchedule setName(String name) {
        this.name = name;
        return this;
    }

    public String getCronExpression() {
        return cronExpression;
    }

    public ScriptSchedule setCronExpression(String cronExpression) {
        this.cronExpression = cronExpression;
        return this;
    }

    public Map<String, Object> getInput() {
        return input;
    }

    public ScriptSchedule setInput(Map<String, Object> input) {
        this.input = input == null ? new LinkedHashMap<>() : new LinkedHashMap<>(input);
        return this;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public ScriptSchedule setEnabled(boolean enabled) {
        this.enabled = enabled;
        return this;
    }

    public LocalDateTime getLastTriggeredAt() {
        return lastTriggeredAt;
    }

    public ScriptSchedule setLastTriggeredAt(LocalDateTime lastTriggeredAt) {
        this.lastTriggeredAt = lastTriggeredAt;
        return this;
    }

    public String getLastExecutionId() {
        return lastExecutionId;
    }

    public ScriptSchedule setLastExecutionId(String lastExecutionId) {
        this.lastExecutionId = lastExecutionId;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public ScriptSchedule setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public ScriptSchedule setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
