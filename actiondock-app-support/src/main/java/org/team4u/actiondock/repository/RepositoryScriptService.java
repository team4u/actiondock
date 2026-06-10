package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.RepositoryLocalAssetMode;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;
import org.team4u.actiondock.common.NormalizeUtils;

import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 仓库工具安装、更新、卸载和发布服务。
 * <p>
 * 负责工具从仓库的安装、升级、卸载和发布配置预览。
 * 上游工作副本同步逻辑由 {@link UpstreamSyncService} 处理，
 * 工具发布逻辑由 {@link ScriptRepositoryPublisher} 处理。
 *
 * @author jay.wu
 */
public class RepositoryScriptService {

    private final RepositoryCatalogService catalog;
    private final RepositoryPluginService pluginService;
    private final RepositoryCatalogService.Repositories repos;
    private final RepositoryCatalogService.ApplicationServices services;
    private final UpstreamSyncService upstreamSync;
    private final ScriptRepositoryPublisher toolRepositoryPublisher;
    private final RepositoryConfigTemplateSyncService configTemplateSyncService;
    private final RepositoryDependencyResolver dependencyResolver;

    public RepositoryScriptService(RepositoryCatalogService catalog,
                                 RepositoryPluginService pluginService,
                                 RepositoryCatalogService.Repositories repos,
                                 RepositoryCatalogService.ApplicationServices services,
                                 RepositoryConfigTemplateSyncService configTemplateSyncService) {
        this.catalog = catalog;
        this.pluginService = pluginService;
        this.repos = repos;
        this.services = services;
        this.upstreamSync = new UpstreamSyncService(catalog, repos, services);
        this.configTemplateSyncService = configTemplateSyncService;
        this.toolRepositoryPublisher = new ScriptRepositoryPublisher(catalog, repos, services);
        this.dependencyResolver = new RepositoryDependencyResolver(catalog);
    }

    public RepositoryLocalAsset addLocalAsset(String repositoryId,
                                             String toolId,
                                             RepositoryLocalAssetRequest request) {
        RepositoryLocalAssetMode mode = parseMode(request == null ? null : request.mode());
        if (mode == RepositoryLocalAssetMode.TRACKED) {
            ScriptDefinition script = upstreamSync.createToolWorkingCopy(repositoryId, toolId,
                    new WorkingCopyRequest(request == null ? null : request.localAssetId()));
            return repos.repositoryLocalAssetRepository()
                    .findByLocalAsset(UpstreamAssetType.SCRIPT, script.getId())
                    .orElseThrow(() -> new IllegalStateException("本地脚本资产记录未创建: " + script.getId()));
        }
        return installOrUpdateTool(repositoryId, toolId,
                request == null ? ToolInstallationOptions.DEFAULT : request.toOptions(),
                false,
                new LinkedHashSet<>());
    }

    public RepositoryLocalAsset updateLocalAsset(String repositoryId,
                                                String toolId,
                                                ToolInstallationOptions options) {
        return installOrUpdateTool(repositoryId, toolId, options, true, new LinkedHashSet<>());
    }

    public UpstreamStatus getUpstreamStatus(String scriptId) {
        return upstreamSync.getScriptUpstreamStatus(scriptId);
    }

    public ScriptDefinition pullUpstreamScript(String scriptId, boolean force) {
        return upstreamSync.pullScript(scriptId, force);
    }

    public void detachUpstream(String scriptId) {
        upstreamSync.detachScript(scriptId);
    }

    public void uninstallScript(String localAssetId) {
        ScriptDefinition definition = repos.scriptRepository().findById(localAssetId)
                .orElseThrow(() -> new IllegalArgumentException("本地工具不存在: " + localAssetId));
        if (definition.getScope() != ScriptScope.REPOSITORY) {
            throw new IllegalArgumentException("仅支持卸载仓库工具");
        }
        repos.scriptScheduleRepository().findAll().stream()
                .filter(item -> localAssetId.equals(item.getRepositoryScriptId()))
                .map(ScriptSchedule::getId)
                .toList()
                .forEach(repos.scriptScheduleRepository()::deleteById);
        repos.scriptRepository().deleteById(localAssetId);
        repos.repositoryLocalAssetRepository()
                .findByLocalAsset(UpstreamAssetType.SCRIPT, localAssetId)
                .ifPresent(asset -> repos.repositoryLocalAssetRepository().deleteById(asset.getId()));
    }

    public RepositoryPublishConfigPreview previewPublishConfig(RepositoryPublishConfigPreviewRequest request) {
        String scriptId = NormalizeUtils.normalize(request == null ? null : request.scriptId(), "scriptId 不能为空");
        List<ScriptSchedule> schedules = RepositoryCatalogTypes.resolvePublishSchedules(scriptId, request == null ? null : request.scheduleIds(), repos.scriptScheduleRepository());
        RepositoryPublishConfigResolver.PublishConfigResolution resolution = RepositoryPublishConfigResolver.resolve(
                request == null ? null : request.source(),
                schedules.stream().map(ScriptSchedule::getInput).toList(),
                repos.configValueRepository().findAll()
        );
        return new RepositoryPublishConfigPreview(
                resolution.items().stream()
                        .map(item -> new RepositoryPublishConfigCandidate(item.key(), item.label(), item.secret()))
                        .toList(),
                resolution.missingKeys()
        );
    }

    public RepositoryScriptDescriptor publishScript(String repositoryId, RepositoryPublishRequest request) {
        RepositoryScriptDescriptor descriptor = toolRepositoryPublisher.publish(repositoryId, request);
        catalog.refreshRepositoryCache(repositoryId);
        return descriptor;
    }

    ScriptRepositoryPublisher publisher() {
        return toolRepositoryPublisher;
    }

    private RepositoryLocalAsset installOrUpdateTool(String repositoryId,
                                                     String toolId,
                                                     ToolInstallationOptions options,
                                                     boolean updateOnly,
                                                     LinkedHashSet<String> visiting) {
        String installationKey = repositoryId + ":" + toolId;
        if (!visiting.add(installationKey)) {
            throw new IllegalStateException("检测到脚本循环依赖: " + String.join(" -> ", visiting) + " -> " + installationKey);
        }
        try {
            RepositoryScriptDetail detail = catalog.getRepositoryScript(repositoryId, toolId);
            RepositoryLocalAsset existingAsset = repos.repositoryLocalAssetRepository()
                    .findByUpstreamAsset(UpstreamAssetType.SCRIPT, repositoryId, toolId)
                    .orElse(null);
            if (existingAsset != null && existingAsset.getMode() != RepositoryLocalAssetMode.LOCKED) {
                throw new IllegalArgumentException("上游脚本已添加为可编辑跟踪资产，不能按只读资产更新: " + existingAsset.getLocalAssetId());
            }
            if (!updateOnly && existingAsset != null) {
                throw new IllegalArgumentException("上游脚本已添加到本地: " + existingAsset.getLocalAssetId());
            }
            if (updateOnly && existingAsset == null) {
                throw new IllegalArgumentException("工具尚未添加为只读本地资产: " + repositoryId + "/" + toolId);
            }
            String localAssetId = existingAsset == null ? repositoryId + "." + toolId : existingAsset.getLocalAssetId();
            ScriptDefinition existing = repos.scriptRepository().findById(localAssetId).orElse(null);
            if (updateOnly && existing == null) {
                throw new IllegalArgumentException("工具尚未添加为只读本地资产: " + repositoryId + "/" + toolId);
            }
            resolveAllDependencies(repositoryId, detail, options, visiting);
            return persistLockedLocalAsset(repositoryId, detail, localAssetId, existing, options);
        } finally {
            visiting.remove(installationKey);
        }
    }

    private void resolveAllDependencies(String repositoryId,
                                        RepositoryScriptDetail detail,
                                        ToolInstallationOptions options,
                                        LinkedHashSet<String> visiting) {
        resolveScriptDependencies(
                detail.descriptor().scriptDependencies(),
                repositoryId,
                options.installScriptDependencies(),
                options.installPluginDependencies(),
                options.forcePluginUpgrade(),
                visiting
        );
        pluginService.resolvePluginDependencies(repositoryId, detail.descriptor().pluginDependencies(), options.installPluginDependencies(), options.forcePluginUpgrade());
    }

    private RepositoryLocalAsset persistLockedLocalAsset(String repositoryId,
                                                         RepositoryScriptDetail detail,
                                                         String localAssetId,
                                                         ScriptDefinition existing,
                                                         ToolInstallationOptions options) {
        LocalDateTime now = LocalDateTime.now();
        ScriptDefinition definition = buildLockedScriptDefinition(repositoryId, detail, localAssetId, existing, now);
        repos.scriptRepository().save(definition);
        configTemplateSyncService.syncConfigTemplates(repositoryId, detail.descriptor().scriptId(), detail.descriptor().version(), detail.configTemplate());
        if (options.installSchedules()) {
            syncScheduleTemplates(definition, detail.scheduleTemplate(), now);
        }
        return saveLockedLocalAsset(definition, existing, detail, now);
    }

    private ScriptDefinition buildLockedScriptDefinition(String repositoryId,
                                                         RepositoryScriptDetail detail,
                                                         String localAssetId,
                                                         ScriptDefinition existing,
                                                         LocalDateTime now) {
        return UpstreamSyncService.applyLifecycle(
                upstreamSync.buildBaseScriptDefinition(localAssetId, detail, repositoryId),
                existing, ScriptScope.REPOSITORY, false, now)
                .setVersion(existing == null ? 1 : (existing.getVersion() == null ? 1 : existing.getVersion() + 1));
    }

    private void resolveScriptDependencies(List<ScriptDependency> dependencies,
                                           String repositoryId,
                                           boolean installScriptDependencies,
                                           boolean installPluginDependencies,
                                           boolean forcePluginUpgrade,
                                           LinkedHashSet<String> visiting) {
        for (ScriptDependency dependency : NormalizeUtils.nullSafeList(dependencies)) {
            String scriptId = NormalizeUtils.normalize(dependency.getScriptId(), "脚本依赖 scriptId 不能为空");
            String depToolId = NormalizeUtils.normalize(dependency.getRepositoryScriptId(), "脚本依赖 scriptId 不能为空: " + scriptId);
            String depRepositoryId = dependencyResolver.resolveToolRepositoryId(repositoryId, dependency.getRepositoryId(), depToolId);
            ScriptDefinition installed = repos.scriptRepository().findInstalledByRepositorySource(depRepositoryId, depToolId).orElse(null);
            if (installed != null && RepositoryVersionUtils.versionSatisfies(installed.getRepositoryVersion(), dependency.getVersionRange())) {
                continue;
            }
            if (!installScriptDependencies) {
                throw new IllegalArgumentException(
                        "缺少脚本依赖或版本不满足: " + scriptId + " -> " + depRepositoryId + "/" + depToolId + " "
                                + NormalizeUtils.normalizeOrDefault(dependency.getVersionRange(), "")
                );
            }
            ensureRemoteVersionSatisfies(scriptId, depRepositoryId, depToolId, dependency.getVersionRange());
            installOrUpdateTool(
                    depRepositoryId,
                    depToolId,
                    new ToolInstallationOptions(false, true, installPluginDependencies, forcePluginUpgrade),
                    installed != null,
                    visiting
            );
        }
    }

    private void ensureRemoteVersionSatisfies(String scriptId, String depRepositoryId, String depToolId, String versionRange) {
        RepositoryScriptDescriptor descriptor = catalog.getRepositoryScript(depRepositoryId, depToolId).descriptor();
        if (!RepositoryVersionUtils.versionSatisfies(descriptor.version(), versionRange)) {
            throw new IllegalArgumentException(
                    "仓库工具版本不满足脚本依赖: " + scriptId + " -> " + depRepositoryId + "/" + depToolId + " "
                            + versionRange
            );
        }
    }

    private RepositoryLocalAsset saveLockedLocalAsset(ScriptDefinition definition,
                                                      ScriptDefinition existing,
                                                      RepositoryScriptDetail detail,
                                                      LocalDateTime now) {
        String localAssetId = definition.getId();
        RepositoryLocalAsset previous = repos.repositoryLocalAssetRepository()
                .findByLocalAsset(UpstreamAssetType.SCRIPT, localAssetId)
                .orElse(null);
        return repos.repositoryLocalAssetRepository().save(new RepositoryLocalAsset()
                .setId(previous == null ? "SCRIPT:LOCKED:" + localAssetId : previous.getId())
                .setAssetType(UpstreamAssetType.SCRIPT)
                .setLocalAssetId(localAssetId)
                .setRepositoryId(definition.getRepositoryId())
                .setUpstreamAssetId(definition.getRepositoryScriptId())
                .setMode(RepositoryLocalAssetMode.LOCKED)
                .setVersion(detail.descriptor().version())
                .setLatestVersion(detail.descriptor().version())
                .setName(definition.getName())
                .setOwner(definition.getOwner())
                .setDescription(definition.getDescription())
                .setCreatedAt(previous == null ? (existing == null ? now : existing.getCreatedAt()) : previous.getCreatedAt())
                .setUpdatedAt(now));
    }

    private RepositoryLocalAssetMode parseMode(String mode) {
        if (NormalizeUtils.isBlank(mode)) {
            return RepositoryLocalAssetMode.LOCKED;
        }
        return RepositoryLocalAssetMode.valueOf(mode);
    }

    private void syncScheduleTemplates(ScriptDefinition definition, List<ScheduleTemplateItem> templates, LocalDateTime now) {
        List<ScriptSchedule> all = repos.scriptScheduleRepository().findAll();
        for (ScheduleTemplateItem template : templates) {
            ScriptSchedule existing = all.stream()
                    .filter(item -> definition.getId().equals(item.getScriptId())
                            && definition.getRepositoryId().equals(item.getRepositoryId())
                            && definition.getId().equals(item.getRepositoryScriptId())
                            && item.getName().equals(template.name()))
                    .findFirst()
                    .orElse(null);
            ScriptSchedule schedule = new ScriptSchedule()
                    .setId(existing == null ? UUID.randomUUID().toString() : existing.getId())
                    .setScriptId(definition.getId())
                    .setName(template.name())
                    .setCronExpression(template.cronExpression())
                    .setInput(template.input() == null ? Map.of() : template.input())
                    .setEnabled(false)
                    .setEditable(false)
                    .setRepositoryId(definition.getRepositoryId())
                    .setRepositoryScriptId(definition.getId())
                    .setRepositoryVersion(definition.getRepositoryVersion())
                    .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                    .setUpdatedAt(now);
            repos.scriptScheduleRepository().save(schedule);
        }
    }

}
