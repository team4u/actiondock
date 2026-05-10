package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.UpstreamBindingEntity;

import java.util.Optional;

public interface SpringDataUpstreamBindingEntityRepository extends JpaRepository<UpstreamBindingEntity, String> {
    Optional<UpstreamBindingEntity> findByAssetTypeAndLocalAssetId(String assetType, String localAssetId);

    Optional<UpstreamBindingEntity> findByAssetTypeAndRepositoryIdAndUpstreamAssetId(String assetType, String repositoryId, String upstreamAssetId);
}
