package org.team4u.actiondock.repository;

import java.nio.file.Path;

final class PluginRepositoryPublisher {
    private final RepositoryCatalogService service;

    PluginRepositoryPublisher(RepositoryCatalogService service) {
        this.service = service;
    }

    RepositoryCatalogService.RepositoryPluginDescriptor publish(String repositoryId,
                                                                RepositoryCatalogService.RepositoryPluginPublishRequest request) {
        WritableRepositorySession session = service.openWritableRepositorySession(repositoryId);

        String pluginId = service.normalize(request.pluginId(), "pluginId 不能为空");
        String displayName = service.normalize(request.displayName(), "displayName 不能为空");
        String version = service.normalize(request.version(), "version 不能为空");
        PluginArtifactRef artifact = service.completePluginArtifactRef(pluginId, request.artifact(), session.repository(), session.root());

        RepositoryCatalogService.assertPluginVersionAvailable(repositoryId, session.index(), pluginId, version);
        Path pluginDir = session.root().resolve("plugins").resolve(pluginId);
        service.writePluginFiles(pluginDir, pluginId, displayName, artifact, request, version);
        service.updateRepositoryPluginIndex(session.root(), session.repository(), pluginId, displayName, request, version);
        session.commitPublishedAsset(pluginId, version, request.releaseNotes());

        return service.getRepositoryPlugin(repositoryId, pluginId).descriptor();
    }
}
