package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.domain.model.UpstreamBinding;
import org.team4u.actiondock.domain.port.UpstreamBindingRepository;
import org.team4u.actiondock.storage.jpa.entity.UpstreamBindingEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataUpstreamBindingEntityRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaUpstreamBindingRepositoryAdapter implements UpstreamBindingRepository {
    private final SpringDataUpstreamBindingEntityRepository repository;

    public JpaUpstreamBindingRepositoryAdapter(SpringDataUpstreamBindingEntityRepository repository) {
        this.repository = repository;
    }

    @Override
    public UpstreamBinding save(UpstreamBinding binding) {
        return toDomain(repository.save(toEntity(binding)));
    }

    @Override
    public Optional<UpstreamBinding> findById(String id) {
        return repository.findById(id).map(JpaUpstreamBindingRepositoryAdapter::toDomain);
    }

    @Override
    public Optional<UpstreamBinding> findByLocalAsset(UpstreamAssetType assetType, String localAssetId) {
        return repository.findByAssetTypeAndLocalAssetId(assetType.name(), localAssetId).map(JpaUpstreamBindingRepositoryAdapter::toDomain);
    }

    @Override
    public Optional<UpstreamBinding> findByUpstreamAsset(UpstreamAssetType assetType, String repositoryId, String upstreamAssetId) {
        return repository.findByAssetTypeAndRepositoryIdAndUpstreamAssetId(assetType.name(), repositoryId, upstreamAssetId).map(JpaUpstreamBindingRepositoryAdapter::toDomain);
    }

    @Override
    public List<UpstreamBinding> findAll() {
        return repository.findAll().stream().map(JpaUpstreamBindingRepositoryAdapter::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    private static UpstreamBindingEntity toEntity(UpstreamBinding binding) {
        UpstreamBindingEntity entity = new UpstreamBindingEntity();
        entity.setId(binding.getId());
        entity.setAssetType(binding.getAssetType().name());
        entity.setLocalAssetId(binding.getLocalAssetId());
        entity.setRepositoryId(binding.getRepositoryId());
        entity.setUpstreamAssetId(binding.getUpstreamAssetId());
        entity.setUpstreamVersion(binding.getUpstreamVersion());
        entity.setSourcePath(binding.getSourcePath());
        entity.setBaseCommit(binding.getBaseCommit());
        entity.setBaseDigest(binding.getBaseDigest());
        entity.setLastSyncedAt(binding.getLastSyncedAt());
        entity.setCreatedAt(binding.getCreatedAt());
        entity.setUpdatedAt(binding.getUpdatedAt());
        return entity;
    }

    private static UpstreamBinding toDomain(UpstreamBindingEntity entity) {
        return new UpstreamBinding()
                .setId(entity.getId())
                .setAssetType(UpstreamAssetType.valueOf(entity.getAssetType()))
                .setLocalAssetId(entity.getLocalAssetId())
                .setRepositoryId(entity.getRepositoryId())
                .setUpstreamAssetId(entity.getUpstreamAssetId())
                .setUpstreamVersion(entity.getUpstreamVersion())
                .setSourcePath(entity.getSourcePath())
                .setBaseCommit(entity.getBaseCommit())
                .setBaseDigest(entity.getBaseDigest())
                .setLastSyncedAt(entity.getLastSyncedAt())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
