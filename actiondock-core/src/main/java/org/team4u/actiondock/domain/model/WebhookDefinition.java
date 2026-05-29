package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;

/**
 * Webhook 定义领域模型。
 * <p>
 * 表示一个 Webhook 端点的完整配置，包括基本信息（名称、描述）、作用域、
 * 来源仓库信息、传输配置以及关联的脚本标识。采用流式 setter 模式支持链式调用。
 *
 * @author jay.wu
 */
public class WebhookDefinition {
    private String id;
    private String key;
    private String name;
    private String description;
    private WebhookScope scope = WebhookScope.PERSONAL;
    private String repositoryId;
    private String repositoryWebhookId;
    private String repositoryVersion;
    private ScriptSourceMetadata sourceMetadata = new ScriptSourceMetadata();
    private boolean editable = true;
    private boolean enabled = true;
    private WebhookTransport transport = new WebhookTransport();
    private String webhookScriptId;
    private WebhookSampleRequest sampleRequest = new WebhookSampleRequest();
    private LocalDateTime lastReceivedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public WebhookDefinition setId(String id) {
        this.id = id;
        return this;
    }

    public String getKey() {
        return key;
    }

    public WebhookDefinition setKey(String key) {
        this.key = key;
        return this;
    }

    public String getName() {
        return name;
    }

    public WebhookDefinition setName(String name) {
        this.name = name;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public WebhookDefinition setDescription(String description) {
        this.description = description;
        return this;
    }

    public WebhookScope getScope() {
        return scope;
    }

    public WebhookDefinition setScope(WebhookScope scope) {
        this.scope = scope == null ? WebhookScope.PERSONAL : scope;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public WebhookDefinition setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getRepositoryWebhookId() {
        return repositoryWebhookId;
    }

    public WebhookDefinition setRepositoryWebhookId(String repositoryWebhookId) {
        this.repositoryWebhookId = repositoryWebhookId;
        return this;
    }

    public String getRepositoryVersion() {
        return repositoryVersion;
    }

    public WebhookDefinition setRepositoryVersion(String repositoryVersion) {
        this.repositoryVersion = repositoryVersion;
        return this;
    }

    public ScriptSourceMetadata getSourceMetadata() {
        return sourceMetadata;
    }

    public WebhookDefinition setSourceMetadata(ScriptSourceMetadata sourceMetadata) {
        this.sourceMetadata = sourceMetadata == null ? new ScriptSourceMetadata() : sourceMetadata;
        return this;
    }

    public String getSourcePath() {
        return sourceMetadata.getPath();
    }

    public WebhookDefinition setSourcePath(String sourcePath) {
        sourceMetadata.setPath(sourcePath);
        return this;
    }

    public String getSourceCommit() {
        return sourceMetadata.getCommit();
    }

    public WebhookDefinition setSourceCommit(String sourceCommit) {
        sourceMetadata.setCommit(sourceCommit);
        return this;
    }

    public String getSourceDigest() {
        return sourceMetadata.getDigest();
    }

    public WebhookDefinition setSourceDigest(String sourceDigest) {
        sourceMetadata.setDigest(sourceDigest);
        return this;
    }

    public LocalDateTime getSourceSyncedAt() {
        return sourceMetadata.getSyncedAt();
    }

    public WebhookDefinition setSourceSyncedAt(LocalDateTime sourceSyncedAt) {
        sourceMetadata.setSyncedAt(sourceSyncedAt);
        return this;
    }

    public boolean isDirty() {
        return sourceMetadata.isDirty();
    }

    public WebhookDefinition setDirty(boolean dirty) {
        sourceMetadata.setDirty(dirty);
        return this;
    }

    public boolean isEditable() {
        return editable;
    }

    public WebhookDefinition setEditable(boolean editable) {
        this.editable = editable;
        return this;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public WebhookDefinition setEnabled(boolean enabled) {
        this.enabled = enabled;
        return this;
    }

    public WebhookTransport getTransport() {
        return transport;
    }

    public WebhookDefinition setTransport(WebhookTransport transport) {
        this.transport = transport == null ? new WebhookTransport() : transport;
        return this;
    }

    public String getWebhookScriptId() {
        return webhookScriptId;
    }

    public WebhookDefinition setWebhookScriptId(String webhookScriptId) {
        this.webhookScriptId = webhookScriptId;
        return this;
    }

    public WebhookSampleRequest getSampleRequest() {
        return sampleRequest == null ? new WebhookSampleRequest() : sampleRequest;
    }

    public WebhookDefinition setSampleRequest(WebhookSampleRequest sampleRequest) {
        this.sampleRequest = sampleRequest == null ? new WebhookSampleRequest() : sampleRequest;
        return this;
    }

    public LocalDateTime getLastReceivedAt() {
        return lastReceivedAt;
    }

    public WebhookDefinition setLastReceivedAt(LocalDateTime lastReceivedAt) {
        this.lastReceivedAt = lastReceivedAt;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public WebhookDefinition setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public WebhookDefinition setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
