package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.CapabilityPackageInstallation;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.port.CapabilityPackageInstallationRepository;
import org.team4u.actiondock.domain.port.ExecutionPresetRepository;

import java.nio.file.Path;
import java.util.LinkedHashSet;

/**
 * 仓库能力包安装、更新、卸载和发布服务。
 * <p>
 * 从 {@link RepositoryCatalogService} 中提取，负责能力包从仓库的安装、升级、卸载和发布操作。
 * 内部实现仍委托给 {@link RepositoryCatalogService} 的 package-private 方法。
 *
 * @author jay.wu
 */
public class RepositoryCapabilityPackageService {

    private final RepositoryCatalogService catalog;
    private final CapabilityPackageInstallationRepository capabilityPackageInstallationRepository;
    private final ExecutionPresetRepository executionPresetRepository;

    public RepositoryCapabilityPackageService(RepositoryCatalogService catalog,
                                               CapabilityPackageInstallationRepository capabilityPackageInstallationRepository,
                                               ExecutionPresetRepository executionPresetRepository) {
        this.catalog = catalog;
        this.capabilityPackageInstallationRepository = capabilityPackageInstallationRepository;
        this.executionPresetRepository = executionPresetRepository;
        catalog.setCapabilityPackageService(this);
    }

    public RepositoryCatalogService.CapabilityPackagePublishPreview previewCapabilityPackage(String repositoryId,
                                                                                              RepositoryCatalogService.CapabilityPackagePublishPreviewRequest request) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        RepositoryCatalogService.CapabilityPackageDraft draft = catalog.buildCapabilityPackageDraft(repository, request);
        return catalog.buildCapabilityPackagePublishPreview(repository, draft);
    }

    public RepositoryCatalogService.CapabilityPackageDescriptor publishCapabilityPackage(String repositoryId,
                                                                                         RepositoryCatalogService.CapabilityPackagePublishRequest request) {
        WritableRepositorySession session = catalog.openWritableRepositorySession(repositoryId);
        RepositoryDefinition repository = session.repository();
        RepositoryCatalogService.CapabilityPackageDraft draft = catalog.buildCapabilityPackageDraft(repository, request);
        RepositoryCatalogService.CapabilityPackagePublishPreview preview = catalog.buildCapabilityPackagePublishPreview(repository, draft);
        if (preview.checks().stream().anyMatch(item -> "BLOCKER".equals(item.severity()))) {
            throw new IllegalArgumentException("能力包存在阻断项，不能发布");
        }
        RepositoryCatalogService.assertCapabilityPackageVersionAvailable(repositoryId, session.index(), draft.packageId(), draft.version());
        Path packageRoot = session.root().resolve("packages").resolve(draft.packageId());
        catalog.writeCapabilityPackageFiles(packageRoot, draft, preview);
        catalog.updateCapabilityPackageIndex(session.root(), repository, draft, preview);
        session.commitPublishedAsset(draft.packageId(), draft.version(), draft.releaseNotes());
        return catalog.getCapabilityPackage(repositoryId, draft.packageId()).descriptor();
    }

    public RepositoryCatalogService.CapabilityPackageInstallResult installCapabilityPackage(String repositoryId, String packageId) {
        return catalog.installOrUpdateCapabilityPackage(repositoryId, packageId, false, new LinkedHashSet<>());
    }

    public RepositoryCatalogService.CapabilityPackageInstallResult updateCapabilityPackage(String repositoryId, String packageId) {
        return catalog.installOrUpdateCapabilityPackage(repositoryId, packageId, true, new LinkedHashSet<>());
    }

    public void uninstallCapabilityPackage(String repositoryId, String packageId) {
        CapabilityPackageInstallation installation = capabilityPackageInstallationRepository
                .findByInstallationId(catalog.capabilityPackageInstallationId(repositoryId, packageId))
                .orElseThrow(() -> new IllegalArgumentException("能力包尚未安装: " + packageId));
        catalog.uninstallManagedCapabilityPackageAssets(installation);
        for (String presetId : installation.getPresetIds()) {
            executionPresetRepository.deleteById(presetId);
        }
        capabilityPackageInstallationRepository.deleteByInstallationId(installation.getInstallationId());
        catalog.removeManagedConfigTemplates(repositoryId, packageId);
    }
}
