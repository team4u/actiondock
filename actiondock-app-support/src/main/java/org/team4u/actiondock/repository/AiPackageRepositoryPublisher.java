package org.team4u.actiondock.repository;

import java.nio.file.Path;
import java.util.List;

final class AiPackageRepositoryPublisher {
    private final RepositoryCatalogService service;

    AiPackageRepositoryPublisher(RepositoryCatalogService service) {
        this.service = service;
    }

    RepositoryCatalogService.RepositoryAiPackageDescriptor publish(String repositoryId,
                                                                   RepositoryCatalogService.RepositoryAiPackagePublishRequest request) {
        WritableRepositorySession session = service.openWritableRepositorySession(repositoryId);

        String packageId = service.normalize(request.packageId(), "packageId 不能为空");
        String version = service.normalize(request.version(), "version 不能为空");
        RepositoryCatalogService.AiPackageBundle bundle = service.buildAiPackageBundle(
                session.repository(),
                service.normalize(request.agentProfileId(), "agentProfileId 不能为空"),
                packageId
        );
        List<RepositoryCatalogService.ConfigTemplateItem> configTemplates = service.buildAiPackageConfigTemplate(bundle);

        RepositoryCatalogService.assertAiPackageVersionAvailable(repositoryId, session.index(), packageId, version);
        Path packageDir = session.root().resolve("ai-packages").resolve(packageId);
        service.writeAiPackageFiles(packageDir, bundle, request, configTemplates);
        service.updateRepositoryAiPackageIndex(session.root(), session.repository(), bundle, request);
        session.commitPublishedAsset(packageId, version, request.releaseNotes());

        return service.getRepositoryAiPackage(repositoryId, packageId).descriptor();
    }
}
