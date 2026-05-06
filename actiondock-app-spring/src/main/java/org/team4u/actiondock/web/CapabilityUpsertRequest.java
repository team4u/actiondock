package org.team4u.actiondock.web;

import org.team4u.actiondock.domain.model.AiDependency;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptStatus;
import org.team4u.actiondock.domain.model.ScriptType;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 统一能力作者态写入请求。当前字段与脚本能力兼容。
 */
public class CapabilityUpsertRequest {
    private String id;
    private String name;
    private ScriptType type = ScriptType.GROOVY;
    private ScriptPackaging packaging = ScriptPackaging.TOOL;
    private String source;
    private String pythonRequirements;
    private Map<String, Object> inputSchema;
    private Map<String, Object> outputSchema;
    private ScriptStatus status = ScriptStatus.DRAFT;
    private Integer version = 1;
    private String description;
    private String owner;
    private List<String> tags;
    private List<ScriptDependency> scriptDependencies;
    private List<PluginDependency> pluginDependencies;
    private List<AiDependency> aiDependencies;
    private PublishedScriptSnapshot publishedSnapshot;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public ScriptDefinition toScriptDefinition() {
        return new ScriptDefinition()
                .setId(id)
                .setName(name)
                .setType(type)
                .setPackaging(packaging)
                .setSource(source)
                .setPythonRequirements(pythonRequirements)
                .setInputSchema(inputSchema)
                .setOutputSchema(outputSchema)
                .setStatus(status)
                .setVersion(version)
                .setDescription(description)
                .setOwner(owner)
                .setTags(tags)
                .setScriptDependencies(scriptDependencies)
                .setPluginDependencies(pluginDependencies)
                .setAiDependencies(aiDependencies)
                .setPublishedSnapshot(publishedSnapshot)
                .setCreatedAt(createdAt)
                .setUpdatedAt(updatedAt);
    }

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

    public ScriptType getType() {
        return type;
    }

    public void setType(ScriptType type) {
        this.type = type;
    }

    public ScriptPackaging getPackaging() {
        return packaging;
    }

    public void setPackaging(ScriptPackaging packaging) {
        this.packaging = packaging;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public String getPythonRequirements() {
        return pythonRequirements;
    }

    public void setPythonRequirements(String pythonRequirements) {
        this.pythonRequirements = pythonRequirements;
    }

    public Map<String, Object> getInputSchema() {
        return inputSchema;
    }

    public void setInputSchema(Map<String, Object> inputSchema) {
        this.inputSchema = inputSchema;
    }

    public Map<String, Object> getOutputSchema() {
        return outputSchema;
    }

    public void setOutputSchema(Map<String, Object> outputSchema) {
        this.outputSchema = outputSchema;
    }

    public ScriptStatus getStatus() {
        return status;
    }

    public void setStatus(ScriptStatus status) {
        this.status = status;
    }

    public Integer getVersion() {
        return version;
    }

    public void setVersion(Integer version) {
        this.version = version;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getOwner() {
        return owner;
    }

    public void setOwner(String owner) {
        this.owner = owner;
    }

    public List<String> getTags() {
        return tags;
    }

    public void setTags(List<String> tags) {
        this.tags = tags;
    }

    public List<ScriptDependency> getScriptDependencies() {
        return scriptDependencies;
    }

    public void setScriptDependencies(List<ScriptDependency> scriptDependencies) {
        this.scriptDependencies = scriptDependencies;
    }

    public List<PluginDependency> getPluginDependencies() {
        return pluginDependencies;
    }

    public void setPluginDependencies(List<PluginDependency> pluginDependencies) {
        this.pluginDependencies = pluginDependencies;
    }

    public List<AiDependency> getAiDependencies() {
        return aiDependencies;
    }

    public void setAiDependencies(List<AiDependency> aiDependencies) {
        this.aiDependencies = aiDependencies;
    }

    public PublishedScriptSnapshot getPublishedSnapshot() {
        return publishedSnapshot;
    }

    public void setPublishedSnapshot(PublishedScriptSnapshot publishedSnapshot) {
        this.publishedSnapshot = publishedSnapshot;
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
