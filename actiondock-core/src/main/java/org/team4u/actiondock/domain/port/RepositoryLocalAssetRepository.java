package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.RepositoryLocalAssetMode;
import org.team4u.actiondock.domain.model.UpstreamAssetType;

import java.util.List;
import java.util.Optional;

public interface RepositoryLocalAssetRepository {
    RepositoryLocalAsset save(RepositoryLocalAsset asset);

    Optional<RepositoryLocalAsset> findById(String id);

    Optional<RepositoryLocalAsset> findByLocalAsset(UpstreamAssetType assetType, String localAssetId);

    Optional<RepositoryLocalAsset> findByUpstreamAsset(UpstreamAssetType assetType, String repositoryId, String upstreamAssetId);

    List<RepositoryLocalAsset> findAll();

    void deleteById(String id);
}
