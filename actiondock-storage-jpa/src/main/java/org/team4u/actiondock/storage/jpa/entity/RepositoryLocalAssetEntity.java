package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "repository_local_asset", indexes = {
        @Index(name = "idx_repository_local_asset_local", columnList = "assetType,localAssetId", unique = true),
        @Index(name = "idx_repository_local_asset_upstream", columnList = "assetType,repositoryId,upstreamAssetId", unique = true)
})
public class RepositoryLocalAssetEntity {
    @Id
    private String id;
    @Column(nullable = false)
    private String assetType;
    @Column(nullable = false)
    private String localAssetId;
    @Column(nullable = false)
    private String repositoryId;
    @Column(nullable = false)
    private String upstreamAssetId;
    @Column(nullable = false)
    private String mode;
    private String versionValue;
    private String latestVersion;
    private String name;
    private String owner;
    @Lob
    private String description;
    private String sourcePath;
    private String baseCommit;
    private String baseDigest;
    private LocalDateTime lastSyncedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getAssetType() { return assetType; }
    public void setAssetType(String assetType) { this.assetType = assetType; }
    public String getLocalAssetId() { return localAssetId; }
    public void setLocalAssetId(String localAssetId) { this.localAssetId = localAssetId; }
    public String getRepositoryId() { return repositoryId; }
    public void setRepositoryId(String repositoryId) { this.repositoryId = repositoryId; }
    public String getUpstreamAssetId() { return upstreamAssetId; }
    public void setUpstreamAssetId(String upstreamAssetId) { this.upstreamAssetId = upstreamAssetId; }
    public String getMode() { return mode; }
    public void setMode(String mode) { this.mode = mode; }
    public String getVersionValue() { return versionValue; }
    public void setVersionValue(String versionValue) { this.versionValue = versionValue; }
    public String getLatestVersion() { return latestVersion; }
    public void setLatestVersion(String latestVersion) { this.latestVersion = latestVersion; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getOwner() { return owner; }
    public void setOwner(String owner) { this.owner = owner; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getSourcePath() { return sourcePath; }
    public void setSourcePath(String sourcePath) { this.sourcePath = sourcePath; }
    public String getBaseCommit() { return baseCommit; }
    public void setBaseCommit(String baseCommit) { this.baseCommit = baseCommit; }
    public String getBaseDigest() { return baseDigest; }
    public void setBaseDigest(String baseDigest) { this.baseDigest = baseDigest; }
    public LocalDateTime getLastSyncedAt() { return lastSyncedAt; }
    public void setLastSyncedAt(LocalDateTime lastSyncedAt) { this.lastSyncedAt = lastSyncedAt; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
