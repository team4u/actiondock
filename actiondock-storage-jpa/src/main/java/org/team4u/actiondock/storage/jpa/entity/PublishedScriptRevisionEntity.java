package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "published_script_revision", indexes = {
        @Index(name = "idx_published_script_revision_script_id", columnList = "script_id")
})
public class PublishedScriptRevisionEntity {
    @Id
    private String id;

    @Column(name = "script_id", nullable = false)
    private String scriptId;

    @Column(name = "version_value", nullable = false)
    private Integer versionValue;

    private LocalDateTime publishedAt;
    private String name;
    private String type;
    private String packaging;

    @Lob
    private String source;
    @Lob
    private String pythonRequirements;
    @Lob
    private String inputSchemaJson;
    @Lob
    private String outputSchemaJson;
    private String owner;
    @Lob
    private String description;
    @Lob
    private String tagsJson;
    @Lob
    private String scriptDependenciesJson;
    @Lob
    private String pluginDependenciesJson;
    @Lob
    private String aiDependenciesJson;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getScriptId() { return scriptId; }
    public void setScriptId(String scriptId) { this.scriptId = scriptId; }
    public Integer getVersionValue() { return versionValue; }
    public void setVersionValue(Integer versionValue) { this.versionValue = versionValue; }
    public LocalDateTime getPublishedAt() { return publishedAt; }
    public void setPublishedAt(LocalDateTime publishedAt) { this.publishedAt = publishedAt; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getPackaging() { return packaging; }
    public void setPackaging(String packaging) { this.packaging = packaging; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public String getPythonRequirements() { return pythonRequirements; }
    public void setPythonRequirements(String pythonRequirements) { this.pythonRequirements = pythonRequirements; }
    public String getInputSchemaJson() { return inputSchemaJson; }
    public void setInputSchemaJson(String inputSchemaJson) { this.inputSchemaJson = inputSchemaJson; }
    public String getOutputSchemaJson() { return outputSchemaJson; }
    public void setOutputSchemaJson(String outputSchemaJson) { this.outputSchemaJson = outputSchemaJson; }
    public String getOwner() { return owner; }
    public void setOwner(String owner) { this.owner = owner; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getTagsJson() { return tagsJson; }
    public void setTagsJson(String tagsJson) { this.tagsJson = tagsJson; }
    public String getScriptDependenciesJson() { return scriptDependenciesJson; }
    public void setScriptDependenciesJson(String scriptDependenciesJson) { this.scriptDependenciesJson = scriptDependenciesJson; }
    public String getPluginDependenciesJson() { return pluginDependenciesJson; }
    public void setPluginDependenciesJson(String pluginDependenciesJson) { this.pluginDependenciesJson = pluginDependenciesJson; }
    public String getAiDependenciesJson() { return aiDependenciesJson; }
    public void setAiDependenciesJson(String aiDependenciesJson) { this.aiDependenciesJson = aiDependenciesJson; }
}
