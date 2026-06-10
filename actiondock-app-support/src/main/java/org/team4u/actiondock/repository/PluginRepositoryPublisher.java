package org.team4u.actiondock.repository;

import org.team4u.actiondock.skill.SkillFileUtils;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;
import org.team4u.actiondock.common.NormalizeUtils;

import java.nio.file.Path;

final class PluginRepositoryPublisher {
    private final RepositoryCatalogService service;
    private final RepositoryAiPackageService aiPackageService;

    PluginRepositoryPublisher(RepositoryCatalogService service, RepositoryAiPackageService aiPackageService) {
        this.service = service;
        this.aiPackageService = aiPackageService;
    }

    RepositoryPluginDescriptor publish(String repositoryId,
                                                                RepositoryPluginPublishRequest request) {
        WritableRepositorySession session = service.openWritableRepositorySession(repositoryId);

        String pluginId = NormalizeUtils.normalize(request.pluginId(), "pluginId 不能为空");
        String displayName = NormalizeUtils.normalize(request.displayName(), "displayName 不能为空");
        String version = NormalizeUtils.normalize(request.version(), SkillFileUtils.ERR_VERSION_REQUIRED);
        PluginArtifactRef artifact = service.completePluginArtifactRef(pluginId, request.artifact(), session.repository(), session.root());

        RepositoryCatalogTypes.assertPluginVersionAvailable(repositoryId, session.index(), pluginId, version);
        Path pluginDir = session.root().resolve(PLUGINS_DIR).resolve(pluginId);
        aiPackageService.writePluginFiles(pluginDir, pluginId, displayName, artifact, request, version);
        session.commitPublishedAsset(pluginId, version, request.releaseNotes());
        service.refreshRepositoryCache(repositoryId);

        return service.getRepositoryPlugin(repositoryId, pluginId).descriptor();
    }
}
