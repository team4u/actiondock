package org.team4u.scriptflow.domain.model;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

public class ScriptDefinition {
    private String id;
    private String name;
    private ScriptType type = ScriptType.GROOVY;
    private String source;
    private Map<String, Object> inputSchema = new LinkedHashMap<>();
    private Map<String, Object> outputSchema = new LinkedHashMap<>();
    private ScriptStatus status = ScriptStatus.DRAFT;
    private Integer version = 1;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public ScriptDefinition() {
    }

    public String getId() {
        return id;
    }

    public ScriptDefinition setId(String id) {
        this.id = id;
        return this;
    }

    public String getName() {
        return name;
    }

    public ScriptDefinition setName(String name) {
        this.name = name;
        return this;
    }

    public ScriptType getType() {
        return type;
    }

    public ScriptDefinition setType(ScriptType type) {
        this.type = type;
        return this;
    }

    public String getSource() {
        return source;
    }

    public ScriptDefinition setSource(String source) {
        this.source = source;
        return this;
    }

    public Map<String, Object> getInputSchema() {
        return inputSchema;
    }

    public ScriptDefinition setInputSchema(Map<String, Object> inputSchema) {
        this.inputSchema = inputSchema == null ? new LinkedHashMap<>() : inputSchema;
        return this;
    }

    public Map<String, Object> getOutputSchema() {
        return outputSchema;
    }

    public ScriptDefinition setOutputSchema(Map<String, Object> outputSchema) {
        this.outputSchema = outputSchema == null ? new LinkedHashMap<>() : outputSchema;
        return this;
    }

    public ScriptStatus getStatus() {
        return status;
    }

    public ScriptDefinition setStatus(ScriptStatus status) {
        this.status = status;
        return this;
    }

    public Integer getVersion() {
        return version;
    }

    public ScriptDefinition setVersion(Integer version) {
        this.version = version;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public ScriptDefinition setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public ScriptDefinition setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
