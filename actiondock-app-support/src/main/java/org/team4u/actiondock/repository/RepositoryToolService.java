package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.RepositoryToolInstallation;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 仓库工具安装、更新、卸载和发布服务。
 * <p>
 * 负责工具从仓库的安装、升级、卸载和发布配置预览。
 * 上游工作副本同步逻辑由 {@link UpstreamSyncService} 处理，
 * 工具发布逻辑由 {@link ToolRepositoryPublisher} 处理。
 *
 * @author jay.wu
 */
public class RepositoryToolService {

    private final RepositoryCatalogService catalog;
    private final RepositoryPluginService pluginService;
    private final RepositoryCatalogService.Repositories repos;
    private final RepositoryCatalogService.ApplicationServices services;
    private final UpstreamSyncService upstreamSync;
    private final ToolRepositoryPublisher toolRepositoryPublisher;
    private final RepositoryConfigTemplateSyncService configTemplateSyncService;

    public RepositoryToolService(RepositoryCatalogService catalog,
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
        this.toolRepositoryPublisher = new ToolRepositoryPublisher(catalog, repos, services);
    }

    public RepositoryToolInstallation installTool(String repositoryId,
                                                 String toolId,
                                                 ToolInstallationOptions options) {
        return installOrUpdateTool(repositoryId, toolId, options, false, new LinkedHashSet<>());
    }

    public RepositoryToolInstallation updateTool(String repositoryId,
                                                 String toolId,
                                                 ToolInstallationOptions options) {
        return installOrUpdateTool(repositoryId, toolId, options, true, new LinkedHashSet<>());
    }

    public ScriptDefinition createToolWorkingCopy(String repositoryId, String toolId, WorkingCopyRequest request) {
        return upstreamSync.createToolWorkingCopy(repositoryId, toolId, request);
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

    public void uninstallTool(String installedScriptId) {
        ScriptDefinition definition = repos.scriptRepository().findById(installedScriptId)
                .orElseThrow(() -> new IllegalArgumentException("已安装工具不存在: " + installedScriptId));
        if (definition.getScope() != ScriptScope.REPOSITORY) {
            throw new IllegalArgumentException("仅支持卸载仓库工具");
        }
        repos.scriptScheduleRepository().findAll().stream()
                .filter(item -> installedScriptId.equals(item.getRepositoryToolId()))
                .map(ScriptSchedule::getId)
                .toList()
                .forEach(repos.scriptScheduleRepository()::deleteById);
        repos.scriptRepository().deleteById(installedScriptId);
        repos.repositoryToolInstallationRepository().deleteByToolId(installedScriptId);
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

    public RepositoryToolDescriptor publishTool(String repositoryId, RepositoryPublishRequest request) {
        return toolRepositoryPublisher.publish(repositoryId, request);
    }

    private RepositoryToolInstallation installOrUpdateTool(String repositoryId,
                                                           String toolId,
                                                           ToolInstallationOptions options,
                                                           boolean updateOnly,
                                                           LinkedHashSet<String> visiting) {
        String installationKey = repositoryId + ":" + toolId;
        if (!visiting.add(installationKey)) {
            throw new IllegalStateException("检测到脚本循环依赖: " + String.join(" -> ", visiting) + " -> " + installationKey);
        }
        try {
            RepositoryToolDetail detail = catalog.getRepositoryTool(repositoryId, toolId);
            String installedScriptId = detail.descriptor().installedScriptId();
            ensureNoWorkingCopy(repositoryId, toolId);
            ScriptDefinition existing = repos.scriptRepository().findById(installedScriptId).orElse(null);
            if (updateOnly && existing == null) {
                throw new IllegalArgumentException("工具尚未安装: " + installedScriptId);
            }
            resolveAllDependencies(repositoryId, detail, options, visiting);
            return persistToolInstallation(repositoryId, detail, existing, options);
        } finally {
            visiting.remove(installationKey);
        }
    }

    private void resolveAllDependencies(String repositoryId,
                                        RepositoryToolDetail detail,
                                        ToolInstallationOptions options,
                                        LinkedHashSet<String> visiting) {
        resolveScriptDependencies(
                detail.descriptor().scriptDependencies(),
                options.installScriptDependencies(),
                options.installPluginDependencies(),
                options.forcePluginUpgrade(),
                visiting
        );
        pluginService.resolvePluginDependencies(repositoryId, detail.descriptor().pluginDependencies(), options.installPluginDependencies(), options.forcePluginUpgrade());
    }

    private RepositoryToolInstallation persistToolInstallation(String repositoryId,
                                                               RepositoryToolDetail detail,
                                                               ScriptDefinition existing,
                                                               ToolInstallationOptions options) {
        LocalDateTime now = LocalDateTime.now();
        ScriptDefinition definition = buildInstalledScriptDefinition(repositoryId, detail, existing, now);
        repos.scriptRepository().save(definition);
        configTemplateSyncService.syncConfigTemplates(repositoryId, detail.descriptor().toolId(), detail.descriptor().version(), detail.configTemplate());
        if (options.installSchedules()) {
            syncScheduleTemplates(definition, detail.scheduleTemplate(), now);
        }
        return saveToolInstallationRecord(definition, existing, detail, now);
    }

    private ScriptDefinition buildInstalledScriptDefinition(String repositoryId,
                                                             RepositoryToolDetail detail,
                                                             ScriptDefinition existing,
                                                             LocalDateTime now) {
        return UpstreamSyncService.applyLifecycle(
                upstreamSync.buildBaseScriptDefinition(detail.descriptor().installedScriptId(), detail, repositoryId),
                existing, ScriptScope.REPOSITORY, false, now)
                .setVersion(existing == null ? 1 : (existing.getVersion() == null ? 1 : existing.getVersion() + 1));
    }

    private RepositoryToolInstallation saveToolInstallationRecord(ScriptDefinition definition,
                                                                   ScriptDefinition existing,
                                                                   RepositoryToolDetail detail,
                                                                   LocalDateTime now) {
        String installedScriptId = definition.getId();
        RepositoryToolInstallation installation = new RepositoryToolInstallation()
                .setToolId(installedScriptId)
                .setRepositoryId(definition.getRepositoryId())
                .setName(definition.getName())
                .setVersion(detail.descriptor().version())
                .setLatestVersion(detail.descriptor().version())
                .setOwner(definition.getOwner())
                .setDescription(definition.getDescription())
                .setInstalledAt(existing == null ? now : Optional.ofNullable(repos.repositoryToolInstallationRepository().findByToolId(installedScriptId)
                        .map(RepositoryToolInstallation::getInstalledAt)
                        .orElse(null)).orElse(now))
                .setUpdatedAt(now);
        return repos.repositoryToolInstallationRepository().save(installation);
    }

    private void resolveScriptDependencies(List<ScriptDependency> dependencies,
                                           boolean installScriptDependencies,
                                           boolean installPluginDependencies,
                                           boolean forcePluginUpgrade,
                                           LinkedHashSet<String> visiting) {
        for (ScriptDependency dependency : NormalizeUtils.nullSafeList(dependencies)) {
            String scriptId = NormalizeUtils.normalize(dependency.getScriptId(), "脚本依赖 scriptId 不能为空");
            String depRepositoryId = NormalizeUtils.normalize(dependency.getRepositoryId(), "脚本依赖 repositoryId 不能为空: " + scriptId);
            String depToolId = NormalizeUtils.normalize(dependency.getToolId(), "脚本依赖 toolId 不能为空: " + scriptId);
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
        RepositoryToolDescriptor descriptor = catalog.getRepositoryTool(depRepositoryId, depToolId).descriptor();
        if (!RepositoryVersionUtils.versionSatisfies(descriptor.version(), versionRange)) {
            throw new IllegalArgumentException(
                    "仓库工具版本不满足脚本依赖: " + scriptId + " -> " + depRepositoryId + "/" + depToolId + " "
                            + versionRange
            );
        }
    }

    private void ensureNoWorkingCopy(String repositoryId, String toolId) {
        repos.upstreamBindingRepository()
                .findByUpstreamAsset(UpstreamAssetType.SCRIPT, repositoryId, toolId)
                .ifPresent(binding -> {
                    throw new IllegalArgumentException("上游脚本已有工作副本，不能同时安装只读资产: " + binding.getLocalAssetId());
                });
    }

    private void syncScheduleTemplates(ScriptDefinition definition, List<ScheduleTemplateItem> templates, LocalDateTime now) {
        List<ScriptSchedule> all = repos.scriptScheduleRepository().findAll();
        for (ScheduleTemplateItem template : templates) {
            ScriptSchedule existing = all.stream()
                    .filter(item -> definition.getId().equals(item.getScriptId())
                            && definition.getRepositoryId().equals(item.getRepositoryId())
                            && definition.getId().equals(item.getRepositoryToolId())
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
                    .setRepositoryToolId(definition.getId())
                    .setRepositoryVersion(definition.getRepositoryVersion())
                    .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                    .setUpdatedAt(now);
            repos.scriptScheduleRepository().save(schedule);
        }
    }

}
