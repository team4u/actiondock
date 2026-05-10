package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.domain.model.UpstreamBinding;

import java.util.List;
import java.util.Optional;

public interface UpstreamBindingRepository {
    UpstreamBinding save(UpstreamBinding binding);

    Optional<UpstreamBinding> findById(String id);

    Optional<UpstreamBinding> findByLocalAsset(UpstreamAssetType assetType, String localAssetId);

    Optional<UpstreamBinding> findByUpstreamAsset(UpstreamAssetType assetType, String repositoryId, String upstreamAssetId);

    List<UpstreamBinding> findAll();

    void deleteById(String id);
}
