package org.team4u.actiondock.storage.jpa.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "upstream_binding", indexes = {
        @Index(name = "idx_upstream_binding_local", columnList = "assetType,localAssetId", unique = true),
        @Index(name = "idx_upstream_binding_upstream", columnList = "assetType,repositoryId,upstreamAssetId", unique = true)
})
public class UpstreamBindingEntity {
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
    private String upstreamVersion;
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
    public String getUpstreamVersion() { return upstreamVersion; }
    public void setUpstreamVersion(String upstreamVersion) { this.upstreamVersion = upstreamVersion; }
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
