package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;

public class UpstreamBinding {
    private String id;
    private UpstreamAssetType assetType;
    private String localAssetId;
    private String repositoryId;
    private String upstreamAssetId;
    private String upstreamVersion;
    private String sourcePath;
    private String baseCommit;
    private String baseDigest;
    private LocalDateTime lastSyncedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public UpstreamBinding setId(String id) {
        this.id = id;
        return this;
    }

    public UpstreamAssetType getAssetType() {
        return assetType;
    }

    public UpstreamBinding setAssetType(UpstreamAssetType assetType) {
        this.assetType = assetType;
        return this;
    }

    public String getLocalAssetId() {
        return localAssetId;
    }

    public UpstreamBinding setLocalAssetId(String localAssetId) {
        this.localAssetId = localAssetId;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public UpstreamBinding setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getUpstreamAssetId() {
        return upstreamAssetId;
    }

    public UpstreamBinding setUpstreamAssetId(String upstreamAssetId) {
        this.upstreamAssetId = upstreamAssetId;
        return this;
    }

    public String getUpstreamVersion() {
        return upstreamVersion;
    }

    public UpstreamBinding setUpstreamVersion(String upstreamVersion) {
        this.upstreamVersion = upstreamVersion;
        return this;
    }

    public String getSourcePath() {
        return sourcePath;
    }

    public UpstreamBinding setSourcePath(String sourcePath) {
        this.sourcePath = sourcePath;
        return this;
    }

    public String getBaseCommit() {
        return baseCommit;
    }

    public UpstreamBinding setBaseCommit(String baseCommit) {
        this.baseCommit = baseCommit;
        return this;
    }

    public String getBaseDigest() {
        return baseDigest;
    }

    public UpstreamBinding setBaseDigest(String baseDigest) {
        this.baseDigest = baseDigest;
        return this;
    }

    public LocalDateTime getLastSyncedAt() {
        return lastSyncedAt;
    }

    public UpstreamBinding setLastSyncedAt(LocalDateTime lastSyncedAt) {
        this.lastSyncedAt = lastSyncedAt;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public UpstreamBinding setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public UpstreamBinding setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
