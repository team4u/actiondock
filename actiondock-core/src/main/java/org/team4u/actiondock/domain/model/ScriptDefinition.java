package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
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
    private String source;
    private Map<String, Object> inputSchema = SchemaValueCopier.copyMap(null);
    private Map<String, Object> outputSchema = SchemaValueCopier.copyMap(null);
    private ScriptStatus status = ScriptStatus.DRAFT;
    private Integer version = 1;
    private PublishedScriptSnapshot publishedSnapshot;
    private ScriptScope scope = ScriptScope.PERSONAL;
    private String repositoryId;
    private String repositoryToolId;
    private String repositoryVersion;
    private boolean editable = true;
    private String owner;
    private String description;
    private List<String> tags = new ArrayList<>();
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
        this.inputSchema = SchemaValueCopier.copyMap(inputSchema);
        return this;
    }

    public Map<String, Object> getOutputSchema() {
        return outputSchema;
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

    /**
     * 获取已发布快照的副本。
     * <p>
     * 如果脚本已发布且存在快照，返回快照的深拷贝以防止意外修改。
     * 如果脚本状态为已发布但无存储快照，则基于当前内容创建临时快照。
     *
     * @return 发布的快照副本，如果未发布则返回 null
     */
    public PublishedScriptSnapshot getPublishedSnapshot() {
        PublishedScriptSnapshot snapshot = resolvePublishedSnapshot();
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
    public boolean hasStoredPublishedSnapshot() {
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
                .setSource(source)
                .setInputSchema(inputSchema)
                .setOutputSchema(outputSchema);
    }

    /**
     * 检查是否存在未发布的更改。
     * <p>
     * 通过比较已发布快照与当前内容来判断是否有未发布的修改。
     *
     * @return 如果存在未发布的更改返回 true
     */
    public boolean getHasUnpublishedChanges() {
        PublishedScriptSnapshot snapshot = resolvePublishedSnapshot();
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
    public ScriptDefinition toPublishedDefinition() {
        PublishedScriptSnapshot snapshot = resolvePublishedSnapshot();
        if (snapshot == null) {
            throw new IllegalStateException("Script not published: " + id);
        }

        return new ScriptDefinition()
                .setId(id)
                .setName(snapshot.getName())
                .setType(snapshot.getType())
                .setSource(snapshot.getSource())
                .setInputSchema(snapshot.getInputSchema())
                .setOutputSchema(snapshot.getOutputSchema())
                .setStatus(ScriptStatus.PUBLISHED)
                .setVersion(version)
                .setPublishedSnapshot(snapshot)
                .setScope(scope)
                .setRepositoryId(repositoryId)
                .setRepositoryToolId(repositoryToolId)
                .setRepositoryVersion(repositoryVersion)
                .setEditable(editable)
                .setOwner(owner)
                .setDescription(description)
                .setTags(tags)
                .setCreatedAt(createdAt)
                .setUpdatedAt(updatedAt);
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
     * 解析已发布的快照。
     * <p>
     * 优先返回存储的快照，如果没有存储快照但状态为已发布，
     * 则基于当前内容创建临时快照。
     *
     * @return 发布的快照，如果未发布则返回 null
     */
    private PublishedScriptSnapshot resolvePublishedSnapshot() {
        if (publishedSnapshot != null) {
            return publishedSnapshot;
        }
        if (status == ScriptStatus.PUBLISHED) {
            return snapshotCurrent();
        }
        return null;
    }
}
