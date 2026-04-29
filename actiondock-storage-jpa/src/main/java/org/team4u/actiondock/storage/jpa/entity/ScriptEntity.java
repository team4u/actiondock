package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 脚本定义 JPA 实体，对应 script_definition 表。
 * <p>
 * 包含脚本草稿内容和已发布快照的平铺字段。
 *
 * @author jay.wu
 */
@Entity
@Table(name = "script_definition", indexes = {
        @Index(name = "idx_script_status", columnList = "status"),
        @Index(name = "idx_script_scope", columnList = "scope")
})
public class ScriptEntity {
    @Id
    private String id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String type;
    private String packaging;

    @Lob
    @Column(nullable = false)
    private String source;

    @Lob
    private String inputSchemaJson;

    @Lob
    private String outputSchemaJson;

    private String publishedName;

    private String publishedType;
    private String publishedPackaging;

    @Lob
    private String publishedSource;

    @Lob
    private String publishedInputSchemaJson;

    @Lob
    private String publishedOutputSchemaJson;
    @Lob
    private String publishedScriptDependenciesJson;
    @Lob
    private String publishedAiDependenciesJson;

    private String status;
    private Integer versionValue;
    private String scope;
    private String repositoryId;
    private String repositoryToolId;
    private String repositoryVersion;
    private String sourcePath;
    private String sourceCommit;
    private String sourceDigest;
    private LocalDateTime sourceSyncedAt;
    private boolean dirty;
    private boolean editable = true;
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
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getPackaging() { return packaging; }
    public void setPackaging(String packaging) { this.packaging = packaging; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public String getInputSchemaJson() { return inputSchemaJson; }
    public void setInputSchemaJson(String inputSchemaJson) { this.inputSchemaJson = inputSchemaJson; }
    public String getOutputSchemaJson() { return outputSchemaJson; }
    public void setOutputSchemaJson(String outputSchemaJson) { this.outputSchemaJson = outputSchemaJson; }
    public String getPublishedName() { return publishedName; }
    public void setPublishedName(String publishedName) { this.publishedName = publishedName; }
    public String getPublishedType() { return publishedType; }
    public void setPublishedType(String publishedType) { this.publishedType = publishedType; }
    public String getPublishedPackaging() { return publishedPackaging; }
    public void setPublishedPackaging(String publishedPackaging) { this.publishedPackaging = publishedPackaging; }
    public String getPublishedSource() { return publishedSource; }
    public void setPublishedSource(String publishedSource) { this.publishedSource = publishedSource; }
    public String getPublishedInputSchemaJson() { return publishedInputSchemaJson; }
    public void setPublishedInputSchemaJson(String publishedInputSchemaJson) { this.publishedInputSchemaJson = publishedInputSchemaJson; }
    public String getPublishedOutputSchemaJson() { return publishedOutputSchemaJson; }
    public void setPublishedOutputSchemaJson(String publishedOutputSchemaJson) { this.publishedOutputSchemaJson = publishedOutputSchemaJson; }
    public String getPublishedScriptDependenciesJson() { return publishedScriptDependenciesJson; }
    public void setPublishedScriptDependenciesJson(String publishedScriptDependenciesJson) { this.publishedScriptDependenciesJson = publishedScriptDependenciesJson; }
    public String getPublishedAiDependenciesJson() { return publishedAiDependenciesJson; }
    public void setPublishedAiDependenciesJson(String publishedAiDependenciesJson) { this.publishedAiDependenciesJson = publishedAiDependenciesJson; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Integer getVersionValue() { return versionValue; }
    public void setVersionValue(Integer versionValue) { this.versionValue = versionValue; }
    public String getScope() { return scope; }
    public void setScope(String scope) { this.scope = scope; }
    public String getRepositoryId() { return repositoryId; }
    public void setRepositoryId(String repositoryId) { this.repositoryId = repositoryId; }
    public String getRepositoryToolId() { return repositoryToolId; }
    public void setRepositoryToolId(String repositoryToolId) { this.repositoryToolId = repositoryToolId; }
    public String getRepositoryVersion() { return repositoryVersion; }
    public void setRepositoryVersion(String repositoryVersion) { this.repositoryVersion = repositoryVersion; }
    public String getSourcePath() { return sourcePath; }
    public void setSourcePath(String sourcePath) { this.sourcePath = sourcePath; }
    public String getSourceCommit() { return sourceCommit; }
    public void setSourceCommit(String sourceCommit) { this.sourceCommit = sourceCommit; }
    public String getSourceDigest() { return sourceDigest; }
    public void setSourceDigest(String sourceDigest) { this.sourceDigest = sourceDigest; }
    public LocalDateTime getSourceSyncedAt() { return sourceSyncedAt; }
    public void setSourceSyncedAt(LocalDateTime sourceSyncedAt) { this.sourceSyncedAt = sourceSyncedAt; }
    public boolean isDirty() { return dirty; }
    public void setDirty(boolean dirty) { this.dirty = dirty; }
    public boolean isEditable() { return editable; }
    public void setEditable(boolean editable) { this.editable = editable; }
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
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
