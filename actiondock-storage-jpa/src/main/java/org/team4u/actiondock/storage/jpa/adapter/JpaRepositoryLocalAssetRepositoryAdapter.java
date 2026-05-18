package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.RepositoryLocalAssetMode;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository;
import org.team4u.actiondock.storage.jpa.entity.RepositoryLocalAssetEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataRepositoryLocalAssetRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaRepositoryLocalAssetRepositoryAdapter implements RepositoryLocalAssetRepository {
    private final SpringDataRepositoryLocalAssetRepository repository;

    public JpaRepositoryLocalAssetRepositoryAdapter(SpringDataRepositoryLocalAssetRepository repository) {
        this.repository = repository;
    }

    @Override
    public RepositoryLocalAsset save(RepositoryLocalAsset asset) {
        return toDomain(repository.save(toEntity(asset)));
    }

    @Override
    public Optional<RepositoryLocalAsset> findById(String id) {
        return repository.findById(id).map(JpaRepositoryLocalAssetRepositoryAdapter::toDomain);
    }

    @Override
    public Optional<RepositoryLocalAsset> findByLocalAsset(UpstreamAssetType assetType, String localAssetId) {
        return repository.findByAssetTypeAndLocalAssetId(assetType.name(), localAssetId)
                .map(JpaRepositoryLocalAssetRepositoryAdapter::toDomain);
    }

    @Override
    public Optional<RepositoryLocalAsset> findByUpstreamAsset(UpstreamAssetType assetType, String repositoryId, String upstreamAssetId) {
        return repository.findByAssetTypeAndRepositoryIdAndUpstreamAssetId(assetType.name(), repositoryId, upstreamAssetId)
                .map(JpaRepositoryLocalAssetRepositoryAdapter::toDomain);
    }

    @Override
    public List<RepositoryLocalAsset> findAll() {
        return repository.findAll().stream().map(JpaRepositoryLocalAssetRepositoryAdapter::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    private static RepositoryLocalAssetEntity toEntity(RepositoryLocalAsset asset) {
        RepositoryLocalAssetEntity entity = new RepositoryLocalAssetEntity();
        entity.setId(asset.getId());
        entity.setAssetType(asset.getAssetType().name());
        entity.setLocalAssetId(asset.getLocalAssetId());
        entity.setRepositoryId(asset.getRepositoryId());
        entity.setUpstreamAssetId(asset.getUpstreamAssetId());
        entity.setMode(asset.getMode().name());
        entity.setVersionValue(asset.getVersion());
        entity.setLatestVersion(asset.getLatestVersion());
        entity.setName(asset.getName());
        entity.setOwner(asset.getOwner());
        entity.setDescription(asset.getDescription());
        entity.setSourcePath(asset.getSourcePath());
        entity.setBaseCommit(asset.getBaseCommit());
        entity.setBaseDigest(asset.getBaseDigest());
        entity.setLastSyncedAt(asset.getLastSyncedAt());
        entity.setCreatedAt(asset.getCreatedAt());
        entity.setUpdatedAt(asset.getUpdatedAt());
        return entity;
    }

    private static RepositoryLocalAsset toDomain(RepositoryLocalAssetEntity entity) {
        return new RepositoryLocalAsset()
                .setId(entity.getId())
                .setAssetType(UpstreamAssetType.valueOf(entity.getAssetType()))
                .setLocalAssetId(entity.getLocalAssetId())
                .setRepositoryId(entity.getRepositoryId())
                .setUpstreamAssetId(entity.getUpstreamAssetId())
                .setMode(RepositoryLocalAssetMode.valueOf(entity.getMode()))
                .setVersion(entity.getVersionValue())
                .setLatestVersion(entity.getLatestVersion())
                .setName(entity.getName())
                .setOwner(entity.getOwner())
                .setDescription(entity.getDescription())
                .setSourcePath(entity.getSourcePath())
                .setBaseCommit(entity.getBaseCommit())
                .setBaseDigest(entity.getBaseDigest())
                .setLastSyncedAt(entity.getLastSyncedAt())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
