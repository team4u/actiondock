package org.team4u.actiondock.domain.model;

import com.fasterxml.jackson.annotation.JsonAlias;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 脚本定义聚合根，保存当前草稿（draft）和已发布修订（published revision）指针。
 * <p>
 * 每个脚本定义包含源码、输入输出 Schema、依赖声明和发布状态。
 * 支持发布/回滚/合并等生命周期操作，通过防御性复制保证集合字段的不可变性。
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
    private Integer version = 1;
    private String publishedRevisionId;
    private LocalDateTime publishedAt;
    private PublishedScriptRevision publishedRevision;
    private ScriptScope scope = ScriptScope.PERSONAL;
    private String repositoryId;
    @JsonAlias("repositoryToolId")
    private String repositoryScriptId;
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
    private Integer maxExecutionRecords = 1000;

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
        this.type = type == null ? ScriptType.GROOVY : type;
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

    public Integer getVersion() {
        return version;
    }

    public ScriptDefinition setVersion(Integer version) {
        this.version = version;
        if (this.publishedRevision != null && version != null) {
            this.publishedRevision = this.publishedRevision.copy().setVersion(version);
        }
        return this;
    }

    public String getPublishedRevisionId() {
        return publishedRevisionId;
    }

    public ScriptDefinition setPublishedRevisionId(String publishedRevisionId) {
        this.publishedRevisionId = publishedRevisionId;
        return this;
    }

    public LocalDateTime getPublishedAt() {
        return publishedAt;
    }

    public ScriptDefinition setPublishedAt(LocalDateTime publishedAt) {
        this.publishedAt = publishedAt;
        return this;
    }

    public PublishedScriptRevision getPublishedRevision() {
        return publishedRevision == null ? null : publishedRevision.copy();
    }

    public ScriptDefinition setPublishedRevision(PublishedScriptRevision publishedRevision) {
        this.publishedRevision = publishedRevision == null ? null : publishedRevision.copy();
        this.publishedRevisionId = this.publishedRevision == null ? null : this.publishedRevision.getId();
        this.publishedAt = this.publishedRevision == null ? null : this.publishedRevision.getPublishedAt();
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

    public String getRepositoryScriptId() {
        return repositoryScriptId;
    }

    public ScriptDefinition setRepositoryScriptId(String repositoryScriptId) {
        this.repositoryScriptId = repositoryScriptId;
        return this;
    }

    @Deprecated
    public ScriptDefinition setRepositoryToolId(String repositoryToolId) {
        return setRepositoryScriptId(repositoryToolId);
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
     * 判断脚本是否存在已发布修订。
     *
     * @return 如果存在已发布修订则返回 true
     */
    public boolean hasPublishedRevision() {
        return publishedRevision != null;
    }

    /**
     * 判断脚本是否存在未发布的变更（草稿与已发布修订内容不一致）。
     *
     * @return 如果存在未发布的变更则返回 true
     */
    public boolean hasUnpublishedChanges() {
        return publishedRevision != null && !publishedRevision.matchesDraft(this);
    }

    /**
     * 将当前草稿字段（名称、源码、Schema、依赖等）复制到目标对象。
     *
     * @param target 目标脚本定义
     * @return 目标对象（支持链式调用）
     */
    private ScriptDefinition copyDraftFieldsTo(ScriptDefinition target) {
        return target
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
                .setAiDependencies(aiDependencies)
                .setMaxExecutionRecords(maxExecutionRecords);
    }

    /**
     * 将当前元数据字段（ID、版本、发布状态、仓库信息等）复制到目标对象。
     *
     * @param target 目标脚本定义
     * @return 目标对象（支持链式调用）
     */
    private ScriptDefinition copyMetadataTo(ScriptDefinition target) {
        return target
                .setId(id)
                .setVersion(version)
                .setPublishedRevisionId(publishedRevisionId)
                .setPublishedAt(publishedAt)
                .setPublishedRevision(publishedRevision)
                .setScope(scope)
                .setRepositoryId(repositoryId)
                .setRepositoryScriptId(repositoryScriptId)
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

    /**
     * 将当前脚本定义转换为已发布版本的定义。
     * <p>
     * 基于已发布修订的内容创建新的脚本定义，保留元数据但使用发布时的源码和配置。
     *
     * @return 已发布版本的脚本定义
     * @throws IllegalStateException 如果脚本尚未发布
     */
    public ScriptDefinition toPublishedDefinition() {
        if (publishedRevision == null) {
            throw new IllegalStateException("脚本未发布: " + id);
        }
        ScriptDefinition definition = new ScriptDefinition()
                .setVersion(version)
                .setPublishedRevision(publishedRevision);
        publishedRevision.applyTo(definition);
        definition.setDirty(false);
        return copyMetadataTo(definition);
    }

    public Integer getMaxExecutionRecords() {
        return maxExecutionRecords;
    }

    public ScriptDefinition setMaxExecutionRecords(Integer maxExecutionRecords) {
        this.maxExecutionRecords = maxExecutionRecords != null ? maxExecutionRecords : 1000;
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

    /**
     * 发布脚本，创建新的已发布修订。
     * <p>
     * 基于当前草稿内容创建 {@link PublishedScriptRevision}，更新版本号并清除脏标记。
     *
     * @param revisionId 新修订 ID
     * @param publishedAt 发布时间
     * @return 当前脚本定义（支持链式调用）
     */
    public ScriptDefinition publish(String revisionId, LocalDateTime publishedAt) {
        PublishedScriptRevision revision = PublishedScriptRevision.fromDraft(this, revisionId, version + 1, publishedAt);
        this.publishedRevision = revision;
        this.publishedRevisionId = revisionId;
        this.publishedAt = publishedAt;
        this.version = revision.getVersion();
        sourceMetadata.setDirty(false);
        return this;
    }

    /**
     * 回滚到已发布修订的内容。
     * <p>
     * 用已发布修订的草稿字段覆盖当前内容，并清除脏标记。
     *
     * @return 当前脚本定义（支持链式调用）
     * @throws IllegalStateException 如果没有已发布修订
     */
    public ScriptDefinition revertToPublished() {
        if (publishedRevision == null) {
            throw new IllegalStateException("没有已发布修订可恢复: " + id);
        }
        publishedRevision.applyTo(this);
        sourceMetadata.setDirty(false);
        return this;
    }

    /**
     * 将已有脚本定义的空字段合并到当前定义。
     * <p>
     * 用于仓库同步等场景，保留已有记录中的历史字段，同时检测草稿内容是否有变更。
     *
     * @param existing 已有的脚本定义（通常来自持久化层）
     * @return 当前脚本定义（支持链式调用）
     */
    public ScriptDefinition mergeFrom(ScriptDefinition existing) {
        mergeNullFieldsFrom(existing);
        setDirty(isEditable() ? existing.isDirty() || !sameDraftAs(existing) : existing.isDirty());
        setEditable(existing.isEditable());
        return this;
    }

    /**
     * 比较两个脚本定义的草稿内容是否一致。
     *
     * @param other 另一个脚本定义
     * @return 如果草稿字段完全相同则返回 true
     */
    private boolean sameDraftAs(ScriptDefinition other) {
        return Objects.equals(name, other.name)
                && type == other.type
                && packaging == other.packaging
                && Objects.equals(source, other.source)
                && Objects.equals(pythonRequirements, other.pythonRequirements)
                && Objects.equals(inputSchema, other.inputSchema)
                && Objects.equals(outputSchema, other.outputSchema)
                && Objects.equals(owner, other.owner)
                && Objects.equals(description, other.description)
                && Objects.equals(tags, other.tags)
                && Objects.equals(scriptDependencies, other.scriptDependencies)
                && Objects.equals(pluginDependencies, other.pluginDependencies)
                && Objects.equals(aiDependencies, other.aiDependencies)
                && Objects.equals(maxExecutionRecords, other.maxExecutionRecords);
    }

    /**
     * 从已有定义中补充当前定义中为 null 的字段。
     *
     * @param existing 已有脚本定义
     */
    private void mergeNullFieldsFrom(ScriptDefinition existing) {
        if (createdAt == null) setCreatedAt(existing.getCreatedAt());
        if (version == null) setVersion(existing.getVersion());
        if (publishedRevisionId == null) setPublishedRevisionId(existing.getPublishedRevisionId());
        if (publishedAt == null) setPublishedAt(existing.getPublishedAt());
        if (publishedRevision == null) setPublishedRevision(existing.getPublishedRevision());
        if (owner == null) setOwner(existing.getOwner());
        if (packaging == null) setPackaging(existing.getPackaging());
        if (description == null) setDescription(existing.getDescription());
        if (pythonRequirements == null) setPythonRequirements(existing.getPythonRequirements());
        if (scope == null) setScope(existing.getScope());
        if (repositoryId == null) setRepositoryId(existing.getRepositoryId());
        if (repositoryScriptId == null) setRepositoryScriptId(existing.getRepositoryScriptId());
        if (repositoryVersion == null) setRepositoryVersion(existing.getRepositoryVersion());
        if (getSourcePath() == null) setSourcePath(existing.getSourcePath());
        if (getSourceCommit() == null) setSourceCommit(existing.getSourceCommit());
        if (getSourceDigest() == null) setSourceDigest(existing.getSourceDigest());
        if (getSourceSyncedAt() == null) setSourceSyncedAt(existing.getSourceSyncedAt());
        if (maxExecutionRecords == null) setMaxExecutionRecords(existing.getMaxExecutionRecords());
    }

    /**
     * 创建当前脚本定义的完整深拷贝。
     * <p>
     * 包含草稿字段和元数据字段的完整复制，用于需要独立修改副本的场景。
     *
     * @return 完整复制的脚本定义
     */
    public ScriptDefinition fullCopy() {
        ScriptDefinition copy = new ScriptDefinition()
                .setVersion(version)
                .setPublishedRevisionId(publishedRevisionId)
                .setPublishedAt(publishedAt)
                .setPublishedRevision(publishedRevision);
        copyDraftFieldsTo(copy);
        return copyMetadataTo(copy);
    }
}
