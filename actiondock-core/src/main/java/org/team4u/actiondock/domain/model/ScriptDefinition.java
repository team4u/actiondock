package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * 脚本定义实体，表示一个可执行的脚本配置。
 * <p>
 * 脚本定义包含脚本的源代码、类型、输入输出模式以及发布状态。
 * 支持草稿和发布两种状态，通过快照机制实现版本管理。
 *
 * @author jay.wu
 */
public class ScriptDefinition {
    private String id;
    private String name;
    private ScriptType type = ScriptType.GROOVY;
    private ScriptPackaging packaging = ScriptPackaging.TOOL;
    private String source;
    private String pythonRequirements;
    private Map<String, Object> inputSchema = SchemaValueCopier.copyMap(null);
    private Map<String, Object> outputSchema = SchemaValueCopier.copyMap(null);
    private ScriptStatus status = ScriptStatus.DRAFT;
    private Integer version = 1;
    private PublishedScriptSnapshot publishedSnapshot;
    private ScriptScope scope = ScriptScope.PERSONAL;
    private String repositoryId;
    private String repositoryToolId;
    private String repositoryVersion;
    private ScriptSourceMetadata sourceMetadata = new ScriptSourceMetadata();
    private boolean editable = true;
    private String owner;
    private String description;
    private List<String> tags = new ArrayList<>();
    private List<ScriptDependency> scriptDependencies = new ArrayList<>();
    private List<PluginDependency> pluginDependencies = new ArrayList<>();
    private List<AiDependency> aiDependencies = new ArrayList<>();
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

    public ScriptPackaging getPackaging() {
        return packaging;
    }

    public ScriptDefinition setPackaging(ScriptPackaging packaging) {
        this.packaging = packaging == null ? ScriptPackaging.TOOL : packaging;
        return this;
    }

    public String getSource() {
        return source;
    }

    public ScriptDefinition setSource(String source) {
        this.source = source;
        return this;
    }

    public String getPythonRequirements() {
        return pythonRequirements;
    }

    public ScriptDefinition setPythonRequirements(String pythonRequirements) {
        this.pythonRequirements = pythonRequirements;
        return this;
    }

    public Map<String, Object> getInputSchema() {
        return Collections.unmodifiableMap(inputSchema);
    }

    public ScriptDefinition setInputSchema(Map<String, Object> inputSchema) {
        this.inputSchema = SchemaValueCopier.copyMap(inputSchema);
        return this;
    }

    public Map<String, Object> getOutputSchema() {
        return Collections.unmodifiableMap(outputSchema);
    }

    public ScriptDefinition setOutputSchema(Map<String, Object> outputSchema) {
        this.outputSchema = SchemaValueCopier.copyMap(outputSchema);
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

    public ScriptScope getScope() {
        return scope;
    }

    public ScriptDefinition setScope(ScriptScope scope) {
        this.scope = scope == null ? ScriptScope.PERSONAL : scope;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public ScriptDefinition setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getRepositoryToolId() {
        return repositoryToolId;
    }

    public ScriptDefinition setRepositoryToolId(String repositoryToolId) {
        this.repositoryToolId = repositoryToolId;
        return this;
    }

    public String getRepositoryVersion() {
        return repositoryVersion;
    }

    public ScriptDefinition setRepositoryVersion(String repositoryVersion) {
        this.repositoryVersion = repositoryVersion;
        return this;
    }

    public ScriptSourceMetadata getSourceMetadata() {
        return sourceMetadata;
    }

    public ScriptDefinition setSourceMetadata(ScriptSourceMetadata sourceMetadata) {
        this.sourceMetadata = sourceMetadata != null ? sourceMetadata : new ScriptSourceMetadata();
        return this;
    }

    public String getSourcePath() {
        return sourceMetadata.getPath();
    }

    public ScriptDefinition setSourcePath(String sourcePath) {
        sourceMetadata.setPath(sourcePath);
        return this;
    }

    public String getSourceCommit() {
        return sourceMetadata.getCommit();
    }

    public ScriptDefinition setSourceCommit(String sourceCommit) {
        sourceMetadata.setCommit(sourceCommit);
        return this;
    }

    public String getSourceDigest() {
        return sourceMetadata.getDigest();
    }

    public ScriptDefinition setSourceDigest(String sourceDigest) {
        sourceMetadata.setDigest(sourceDigest);
        return this;
    }

    public LocalDateTime getSourceSyncedAt() {
        return sourceMetadata.getSyncedAt();
    }

    public ScriptDefinition setSourceSyncedAt(LocalDateTime sourceSyncedAt) {
        sourceMetadata.setSyncedAt(sourceSyncedAt);
        return this;
    }

    public boolean isDirty() {
        return sourceMetadata.isDirty();
    }

    public ScriptDefinition setDirty(boolean dirty) {
        sourceMetadata.setDirty(dirty);
        return this;
    }

    public boolean isEditable() {
        return editable;
    }

    public ScriptDefinition setEditable(boolean editable) {
        this.editable = editable;
        return this;
    }

    public String getOwner() {
        return owner;
    }

    public ScriptDefinition setOwner(String owner) {
        this.owner = owner;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public ScriptDefinition setDescription(String description) {
        this.description = description;
        return this;
    }

    public List<String> getTags() {
        return List.copyOf(tags);
    }

    public ScriptDefinition setTags(List<String> tags) {
        this.tags = tags == null ? new ArrayList<>() : new ArrayList<>(tags);
        return this;
    }

    public List<PluginDependency> getPluginDependencies() {
        return SchemaValueCopier.copyList(pluginDependencies, PluginDependency::copy);
    }

    public ScriptDefinition setPluginDependencies(List<PluginDependency> pluginDependencies) {
        this.pluginDependencies = SchemaValueCopier.copyList(pluginDependencies, PluginDependency::copy);
        return this;
    }

    public List<ScriptDependency> getScriptDependencies() {
        return SchemaValueCopier.copyList(scriptDependencies, ScriptDependency::copy);
    }

    public ScriptDefinition setScriptDependencies(List<ScriptDependency> scriptDependencies) {
        this.scriptDependencies = SchemaValueCopier.copyList(scriptDependencies, ScriptDependency::copy);
        return this;
    }

    public List<AiDependency> getAiDependencies() {
        return SchemaValueCopier.copyList(aiDependencies, AiDependency::copy);
    }

    public ScriptDefinition setAiDependencies(List<AiDependency> aiDependencies) {
        this.aiDependencies = SchemaValueCopier.copyList(aiDependencies, AiDependency::copy);
        return this;
    }

    /**
     * 获取已发布快照的副本。
     * <p>
     * 如果脚本已发布且存在快照，返回快照的深拷贝以防止意外修改。
     * 如果脚本状态为已发布但无存储快照，则基于当前内容创建临时快照。
     *
     * @return 发布的快照副本，如果未发布则返回 null
     */
    public PublishedScriptSnapshot getPublishedSnapshot() {
        PublishedScriptSnapshot snapshot = resolveEffectiveSnapshot();
        return snapshot == null ? null : snapshot.copy();
    }

    public ScriptDefinition setPublishedSnapshot(PublishedScriptSnapshot publishedSnapshot) {
        this.publishedSnapshot = publishedSnapshot == null ? null : publishedSnapshot.copy();
        return this;
    }

    /**
     * 检查是否存在存储的发布快照。
     *
     * @return 如果存在存储的发布快照返回 true
     */
    private boolean hasStoredPublishedSnapshot() {
        return publishedSnapshot != null;
    }

    /**
     * 创建当前状态的快照。
     * <p>
     * 快照包含脚本的当前名称、类型、源代码和输入输出模式。
     * 用于保存脚本的发布版本。
     *
     * @return 基于当前内容创建的新快照实例
     */
    public PublishedScriptSnapshot snapshotCurrent() {
        return new PublishedScriptSnapshot()
                .setName(name)
                .setType(type)
                .setPackaging(packaging)
                .setSource(source)
                .setPythonRequirements(pythonRequirements)
                .setInputSchema(inputSchema)
                .setOutputSchema(outputSchema)
                .setOwner(owner)
                .setDescription(description)
                .setTags(tags)
                .setScriptDependencies(scriptDependencies)
                .setPluginDependencies(pluginDependencies)
                .setAiDependencies(aiDependencies);
    }

    /**
     * 检查是否存在未发布的更改。
     * <p>
     * 通过比较已发布快照与当前内容来判断是否有未发布的修改。
     *
     * @return 如果存在未发布的更改返回 true
     */
    public boolean getHasUnpublishedChanges() {
        PublishedScriptSnapshot snapshot = getStoredSnapshot();
        return snapshot != null && !snapshot.equals(snapshotCurrent());
    }

    /**
     * 将脚本转换为已发布状态的定义。
     * <p>
     * 基于存储的发布快照创建一个新的脚本定义，设置状态为已发布。
     * 用于执行已发布的脚本版本，确保用户获取的是经过审批的稳定版本。
     *
     * @return 已发布状态的脚本定义
     * @throws IllegalStateException 如果脚本尚未发布
     */
    private ScriptDefinition copyMetadataTo(ScriptDefinition target) {
        return target
                .setId(id)
                .setScope(scope)
                .setRepositoryId(repositoryId)
                .setRepositoryToolId(repositoryToolId)
                .setRepositoryVersion(repositoryVersion)
                .setSourcePath(getSourcePath())
                .setSourceCommit(getSourceCommit())
                .setSourceDigest(getSourceDigest())
                .setSourceSyncedAt(getSourceSyncedAt())
                .setDirty(isDirty())
                .setEditable(editable)
                .setCreatedAt(createdAt)
                .setUpdatedAt(updatedAt);
    }

    public ScriptDefinition toPublishedDefinition() {
        PublishedScriptSnapshot snapshot = resolveEffectiveSnapshot();
        if (snapshot == null) {
            throw new IllegalStateException("脚本尚未发布: " + id);
        }

        ScriptDefinition definition = new ScriptDefinition()
                .setStatus(ScriptStatus.PUBLISHED)
                .setVersion(version)
                .setPublishedSnapshot(snapshot);
        snapshot.applyTo(definition);
        return copyMetadataTo(definition);
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

    /**
     * 获取已存储的发布快照。
     *
     * @return 存储的快照，如果没有则返回 null
     */
    private PublishedScriptSnapshot getStoredSnapshot() {
        return publishedSnapshot;
    }

    /**
     * 解析有效的发布快照。
     * <p>
     * 优先返回存储的快照，如果没有存储快照但状态为已发布，
     * 则基于当前内容创建临时快照。
     *
     * @return 发布的快照，如果未发布则返回 null
     */
    private PublishedScriptSnapshot resolveEffectiveSnapshot() {
        if (publishedSnapshot != null) {
            return publishedSnapshot;
        }
        if (status == ScriptStatus.PUBLISHED) {
            return snapshotCurrent();
        }
        return null;
    }

    /**
     * 发布脚本，将当前内容冻结为发布快照并切换为 PUBLISHED 状态。
     *
     * @return 当前实例
     * @throws IllegalStateException 如果脚本是 ARCHIVED 状态
     */
    public ScriptDefinition publish() {
        if (status == ScriptStatus.ARCHIVED) {
            throw new IllegalStateException("已归档脚本不能发布: " + id);
        }
        this.publishedSnapshot = snapshotCurrent();
        this.status = ScriptStatus.PUBLISHED;
        this.version = version + 1;
        sourceMetadata.setDirty(false);
        return this;
    }

    /**
     * 丢弃草稿，恢复为已发布快照的内容。
     *
     * @return 当前实例
     * @throws IllegalStateException 如果没有已发布快照
     */
    ScriptDefinition revertToPublished() {
        PublishedScriptSnapshot snapshot = getStoredSnapshot();
        if (snapshot == null) {
            throw new IllegalStateException("没有已发布快照可恢复: " + id);
        }
        snapshot.applyTo(this);
        this.status = ScriptStatus.PUBLISHED;
        sourceMetadata.setDirty(false);
        return this;
    }

    /**
     * 从已有的脚本定义合并缺失字段。
     * <p>
     * 当传入的定义中某个字段为 null 时，使用已有定义的对应字段填充。
     * 同时根据比较结果计算 dirty 标志。
     *
     * @param existing 已有的脚本定义
     * @return 当前实例
     */
    public ScriptDefinition mergeFrom(ScriptDefinition existing) {
        mergeNullFieldsFrom(existing);
        if (scope == ScriptScope.DEVELOPMENT) {
            setDirty(existing.isDirty() || !snapshotCurrent().equals(existing.snapshotCurrent()));
        } else {
            setDirty(existing.isDirty());
        }
        setEditable(existing.isEditable());
        return this;
    }

    private void mergeNullFieldsFrom(ScriptDefinition existing) {
        if (createdAt == null) setCreatedAt(existing.getCreatedAt());
        if (version == null) setVersion(existing.getVersion());
        if (owner == null) setOwner(existing.getOwner());
        if (packaging == null) setPackaging(existing.getPackaging());
        if (description == null) setDescription(existing.getDescription());
        if (pythonRequirements == null) setPythonRequirements(existing.getPythonRequirements());
        if (status == null) setStatus(existing.getStatus());
        if (!hasStoredPublishedSnapshot()) setPublishedSnapshot(existing.getPublishedSnapshot());
        if (scope == null) setScope(existing.getScope());
        if (repositoryId == null) setRepositoryId(existing.getRepositoryId());
        if (repositoryToolId == null) setRepositoryToolId(existing.getRepositoryToolId());
        if (repositoryVersion == null) setRepositoryVersion(existing.getRepositoryVersion());
        if (getSourcePath() == null) setSourcePath(existing.getSourcePath());
        if (getSourceCommit() == null) setSourceCommit(existing.getSourceCommit());
        if (getSourceDigest() == null) setSourceDigest(existing.getSourceDigest());
        if (getSourceSyncedAt() == null) setSourceSyncedAt(existing.getSourceSyncedAt());
    }

    public ScriptDefinition fullCopy() {
        ScriptDefinition copy = new ScriptDefinition()
                .setStatus(status)
                .setVersion(version)
                .setPublishedSnapshot(publishedSnapshot);
        snapshotCurrent().applyTo(copy);
        return copyMetadataTo(copy);
    }

    public void normalizePublicationState() {
        if (hasStoredPublishedSnapshot()) {
            setStatus(ScriptStatus.PUBLISHED);
            return;
        }
        if (status == ScriptStatus.PUBLISHED) {
            setPublishedSnapshot(snapshotCurrent());
        }
    }
}
