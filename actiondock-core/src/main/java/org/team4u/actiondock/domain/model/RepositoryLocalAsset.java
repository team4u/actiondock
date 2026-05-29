package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;

/**
 * 仓库本地资产，记录仓库中安装的上游资产快照。
 * <p>
 * 每条记录对应一个从上游同步到本地仓库的资产（脚本或 Webhook），
 * 包含版本锁定、同步状态以及来源追踪等信息。
 *
 * @author jay.wu
 */
public class RepositoryLocalAsset {
    private String id;
    private UpstreamAssetType assetType;
    private String localAssetId;
    private String repositoryId;
    private String upstreamAssetId;
    private RepositoryLocalAssetMode mode = RepositoryLocalAssetMode.LOCKED;
    private String version;
    private String latestVersion;
    private String name;
    private String owner;
    private String description;
    private String sourcePath;
    private String baseCommit;
    private String baseDigest;
    private LocalDateTime lastSyncedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public RepositoryLocalAsset setId(String id) {
        this.id = id;
        return this;
    }

    public UpstreamAssetType getAssetType() {
        return assetType;
    }

    public RepositoryLocalAsset setAssetType(UpstreamAssetType assetType) {
        this.assetType = assetType;
        return this;
    }

    public String getLocalAssetId() {
        return localAssetId;
    }

    public RepositoryLocalAsset setLocalAssetId(String localAssetId) {
        this.localAssetId = localAssetId;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public RepositoryLocalAsset setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getUpstreamAssetId() {
        return upstreamAssetId;
    }

    public RepositoryLocalAsset setUpstreamAssetId(String upstreamAssetId) {
        this.upstreamAssetId = upstreamAssetId;
        return this;
    }

    public RepositoryLocalAssetMode getMode() {
        return mode;
    }

    public RepositoryLocalAsset setMode(RepositoryLocalAssetMode mode) {
        this.mode = mode == null ? RepositoryLocalAssetMode.LOCKED : mode;
        return this;
    }

    public String getVersion() {
        return version;
    }

    public RepositoryLocalAsset setVersion(String version) {
        this.version = version;
        return this;
    }

    public String getLatestVersion() {
        return latestVersion;
    }

    public RepositoryLocalAsset setLatestVersion(String latestVersion) {
        this.latestVersion = latestVersion;
        return this;
    }

    public String getName() {
        return name;
    }

    public RepositoryLocalAsset setName(String name) {
        this.name = name;
        return this;
    }

    public String getOwner() {
        return owner;
    }

    public RepositoryLocalAsset setOwner(String owner) {
        this.owner = owner;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public RepositoryLocalAsset setDescription(String description) {
        this.description = description;
        return this;
    }

    public String getSourcePath() {
        return sourcePath;
    }

    public RepositoryLocalAsset setSourcePath(String sourcePath) {
        this.sourcePath = sourcePath;
        return this;
    }

    public String getBaseCommit() {
        return baseCommit;
    }

    public RepositoryLocalAsset setBaseCommit(String baseCommit) {
        this.baseCommit = baseCommit;
        return this;
    }

    public String getBaseDigest() {
        return baseDigest;
    }

    public RepositoryLocalAsset setBaseDigest(String baseDigest) {
        this.baseDigest = baseDigest;
        return this;
    }

    public LocalDateTime getLastSyncedAt() {
        return lastSyncedAt;
    }

    public RepositoryLocalAsset setLastSyncedAt(LocalDateTime lastSyncedAt) {
        this.lastSyncedAt = lastSyncedAt;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public RepositoryLocalAsset setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public RepositoryLocalAsset setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
