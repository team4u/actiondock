package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

/**
 * AI 能力包草稿构建、依赖收集和文件写入服务。
 * <p>
 * 从 {@link RepositoryCatalogService} 中提取，负责构建 AI 能力包的 bundle、草稿（draft）、
 * 发布预览（publish preview），以及写入能力包文件和更新仓库索引。
 *
 * @author jay.wu
 */
class RepositoryAiPackageService {


    private static final String CAPABILITY_PACKAGE_MANIFEST_FILE = "package.json";
    private static final String CAPABILITY_PACKAGE_RELEASE_FILE = "release.json";

    private final RepositoryCatalogService catalog;
    private final AiPackageDependencyCollector dependencyCollector;
    private final CapabilityPackageBuilderService builderService;

    RepositoryAiPackageService(RepositoryCatalogService catalog,
                               RepositoryCatalogService.Repositories repos,
                               RepositoryCatalogService.ApplicationServices services) {
        this.catalog = catalog;
        this.dependencyCollector = new AiPackageDependencyCollector(
                repos.aiAgentProfileRepository(),
                repos.aiModelProfileRepository(),
                repos.aiToolsetRepository(),
                repos.capabilityPackageInstallationRepository(),
                repos.scriptRepository(),
                services.scriptApplicationService(),
                services.pluginRuntimeService()
        );
        this.builderService = new CapabilityPackageBuilderService(
                repos.scriptRepository(),
                repos.scriptScheduleRepository(),
                repos.executionPresetRepository(),
                repos.configValueRepository(),
                repos.aiAgentProfileRepository(),
                dependencyCollector
        );
    }

    AiPackageBundle buildAiPackageBundle(RepositoryDefinition repository,
                                         String entryAgentId,
                                         String packageId) {
        AiPackageBundleBuilder builder = new AiPackageBundleBuilder(repository, packageId, entryAgentId);
        dependencyCollector.collectAgentDependency(repository, builder, entryAgentId, true);
        return builder.build();
    }

    List<ConfigTemplateItem> buildAiPackageConfigTemplate(AiPackageBundle bundle) {
        return builderService.buildAiPackageConfigTemplate(bundle);
    }

    CapabilityPackageDraft buildCapabilityPackageDraft(RepositoryDefinition repository,
                                                       RepositoryCatalogTypes.CapabilityPackagePublishRequest request) {
        return builderService.buildCapabilityPackageDraft(repository, request);
    }

    CapabilityPackagePublishPreview buildCapabilityPackagePublishPreview(RepositoryDefinition repository,
                                                                         CapabilityPackageDraft draft) {
        RepositoryCatalogTypes.CapabilityPackageDetail currentPackage = null;
        try {
            currentPackage = catalog.getCapabilityPackage(repository.getId(), draft.packageId());
        } catch (IllegalArgumentException ignored) {
            // 能力包尚未发布，首次发布预览
        }
        return builderService.buildCapabilityPackagePublishPreview(repository, draft, currentPackage);
    }

    void writeCapabilityPackageFiles(Path packageRoot,
                                     CapabilityPackageDraft draft) {
        try {
            Path versionsDir = packageRoot.resolve("versions").resolve(draft.version());
            Files.createDirectories(versionsDir);
            writeTemplateFiles(versionsDir, draft);
            String latestReleasePath = CAPABILITY_PACKAGES_DIR + "/" + draft.packageId() + "/versions/" + draft.version() + "/" + CAPABILITY_PACKAGE_RELEASE_FILE;
            catalog.writeJson(versionsDir.resolve(CAPABILITY_PACKAGE_RELEASE_FILE), new CapabilityPackageReleaseFile(
                    1,
                    draft.packageId(),
                    draft.displayName(),
                    draft.version(),
                    draft.description(),
                    draft.releaseNotes(),
                    draft.owner(),
                    draft.tags(),
                    draft.riskLevel(),
                    draft.source().name(),
                    draft.entries(),
                    new ArrayList<>(draft.bundle().models().values()),
                    new ArrayList<>(draft.bundle().toolsets().values()),
                    new ArrayList<>(draft.bundle().agents().values()),
                    new ArrayList<>(draft.bundle().scripts().values()),
                    draft.bundle().externalDependencies().values().stream().toList(),
                    draft.configTemplate().isEmpty() ? null : "config.template.json",
                    draft.scheduleTemplate().isEmpty() ? null : "schedules.template.json",
                    draft.presetTemplate().isEmpty() ? null : "presets.template.json"
            ));
            catalog.writeJson(packageRoot.resolve(CAPABILITY_PACKAGE_MANIFEST_FILE), new CapabilityPackageManifestFile(
                    1,
                    draft.packageId(),
                    draft.displayName(),
                    draft.version(),
                    draft.description(),
                    draft.releaseNotes(),
                    draft.owner(),
                    draft.tags(),
                    draft.riskLevel(),
                    draft.entries(),
                    latestReleasePath
            ));
        } catch (IOException exception) {
            throw new IllegalStateException("写入能力包文件失败", exception);
        }
    }

    private void writeTemplateFiles(Path versionsDir, CapabilityPackageDraft draft) {
        if (!draft.configTemplate().isEmpty()) {
            catalog.writeJson(versionsDir.resolve("config.template.json"), draft.configTemplate());
        }
        if (!draft.scheduleTemplate().isEmpty()) {
            catalog.writeJson(versionsDir.resolve("schedules.template.json"), draft.scheduleTemplate());
        }
        if (!draft.presetTemplate().isEmpty()) {
            catalog.writeJson(versionsDir.resolve("presets.template.json"), draft.presetTemplate());
        }
    }

    void writePluginFiles(Path pluginDir,
                          String pluginId,
                          String displayName,
                          PluginArtifactRef artifact,
                          RepositoryPluginPublishRequest request,
                          String version) {
        try {
            Files.createDirectories(pluginDir);
            catalog.writeJson(pluginDir.resolve(PLUGIN_INDEX_FILE), new PluginFile(
                    1,
                    pluginId,
                    displayName,
                    version,
                    NormalizeUtils.normalizeNullable(request.description()),
                    NormalizeUtils.normalizeNullable(request.releaseNotes()),
                    NormalizeUtils.normalizeNullable(request.owner()),
                    NormalizeUtils.nullSafeList(request.tags()),
                    artifact,
                    NormalizeUtils.normalizeNullable(request.riskLevel())
            ));
        } catch (IOException exception) {
            throw new IllegalStateException("写入仓库插件文件失败", exception);
        }
    }
}
