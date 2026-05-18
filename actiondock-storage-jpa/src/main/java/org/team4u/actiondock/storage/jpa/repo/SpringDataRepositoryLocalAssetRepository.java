package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.RepositoryLocalAssetEntity;

import java.util.Optional;

public interface SpringDataRepositoryLocalAssetRepository extends JpaRepository<RepositoryLocalAssetEntity, String> {
    Optional<RepositoryLocalAssetEntity> findByAssetTypeAndLocalAssetId(String assetType, String localAssetId);

    Optional<RepositoryLocalAssetEntity> findByAssetTypeAndRepositoryIdAndUpstreamAssetId(String assetType, String repositoryId, String upstreamAssetId);
}
