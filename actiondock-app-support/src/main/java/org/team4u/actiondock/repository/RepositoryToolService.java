package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.RepositoryToolInstallation;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.ScriptStatus;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.exception.DevelopmentConflictException;
import org.team4u.actiondock.skill.SkillFileUtils;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 仓库工具安装、更新、卸载和开发同步服务。
 * <p>
 * 负责工具从仓库的安装、升级、卸载、开发同步、发布配置预览等职责。
 * 工具发布逻辑由 {@link ToolRepositoryPublisher} 处理。
 *
 * @author jay.wu
 */
public class RepositoryToolService {

    private final RepositoryCatalogService catalog;
    private final RepositoryPluginService pluginService;
    private final RepositoryCatalogService.Repositories repos;
    private final RepositoryCatalogService.ApplicationServices services;
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
        this.configTemplateSyncService = configTemplateSyncService;
        this.toolRepositoryPublisher = new ToolRepositoryPublisher(catalog, repos, services);
    }

    public RepositoryToolInstallation installTool(String repositoryId, String toolId, boolean installSchedules) {
        return installTool(repositoryId, toolId, new ToolInstallationOptions(installSchedules, false, false, false));
    }

    public RepositoryToolInstallation installTool(String repositoryId,
                                                 String toolId,
                                                 ToolInstallationOptions options) {
        return installOrUpdateTool(repositoryId, toolId, options, false, new LinkedHashSet<>());
    }

    public RepositoryToolInstallation updateTool(String repositoryId, String toolId, boolean installSchedules) {
        return updateTool(repositoryId, toolId, new ToolInstallationOptions(installSchedules, false, false, false));
    }

    public RepositoryToolInstallation updateTool(String repositoryId,
                                                 String toolId,
                                                 ToolInstallationOptions options) {
        return installOrUpdateTool(repositoryId, toolId, options, true, new LinkedHashSet<>());
    }

    public ScriptDefinition syncToolForDevelopment(String repositoryId, String toolId, DevelopmentSyncRequest request) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        catalog.ensureDevelopmentRepository(repository);
        RepositoryToolDetail detail = catalog.getRepositoryTool(repositoryId, toolId);
        String scriptId = SkillFileUtils.normalizeOrDefault(request == null ? null : request.scriptId(), detail.descriptor().toolId());
        ScriptDefinition existing = repos.scriptRepository().findById(scriptId).orElse(null);
        if (existing != null && existing.getScope() != ScriptScope.DEVELOPMENT) {
            throw new IllegalArgumentException("脚本 ID 已存在，请指定其他开发脚本 ID: " + scriptId);
        }
        if (existing != null) {
            return pullDevelopmentScript(scriptId, false);
        }
        ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        return saveDevelopmentScript(scriptId, existing, detail, state);
    }

    public DevelopmentStatus getDevelopmentStatus(String scriptId) {
        ScriptDefinition script = services.scriptApplicationService().get(scriptId);
        catalog.ensureDevelopmentScript(script);
        RepositoryDefinition repository = catalog.getRepository(script.getRepositoryId());
        RepositoryToolDetail detail = catalog.getRepositoryTool(repository.getId(), script.getRepositoryToolId());
        ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        String localDigest = catalog.computeDevelopmentLocalDigest(script);
        DevelopmentSyncState syncState = catalog.resolveDevelopmentSyncState(script, localDigest, state);
        boolean remoteChanged = catalog.isRemoteChanged(script, state);
        boolean dirty = catalog.isLocalChanged(script, localDigest);
        return new DevelopmentStatus(
                script.getId(),
                script.getRepositoryId(),
                script.getRepositoryToolId(),
                script.getRepositoryVersion(),
                script.getSourceCommit(),
                state.commit(),
                script.getSourceDigest(),
                localDigest,
                state.digest(),
                dirty,
                remoteChanged,
                syncState.name(),
                detail.descriptor().version(),
                script.getSourceSyncedAt()
        );
    }

    public ScriptDefinition pullDevelopmentScript(String scriptId, boolean force) {
        ScriptDefinition script = services.scriptApplicationService().get(scriptId);
        catalog.ensureDevelopmentScript(script);
        RepositoryDefinition repository = catalog.getRepository(script.getRepositoryId());
        catalog.syncRepository(repository.getId());
        RepositoryToolDetail detail = catalog.getRepositoryTool(repository.getId(), script.getRepositoryToolId());
        ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        String localDigest = catalog.computeDevelopmentLocalDigest(script);
        DevelopmentSyncState syncState = catalog.resolveDevelopmentSyncState(script, localDigest, state);
        if (syncState == DevelopmentSyncState.SYNCED) {
            return script;
        }
        if (syncState == DevelopmentSyncState.LOCAL_CHANGES && !force) {
            return script;
        }
        if (syncState == DevelopmentSyncState.DIVERGED && !force) {
            throw new DevelopmentConflictException(script.getId(), script.getRepositoryId(), script.getRepositoryToolId());
        }
        return saveDevelopmentScript(script.getId(), script, detail, state);
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
        String scriptId = SkillFileUtils.normalize(request == null ? null : request.scriptId(), "scriptId 不能为空");
        List<ScriptSchedule> schedules = RepositoryCatalogService.resolvePublishSchedules(scriptId, request == null ? null : request.scheduleIds(), repos.scriptScheduleRepository());
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
            syncScheduleTemplates(definition, detail.scheduleTemplate());
        }
        return saveToolInstallationRecord(definition, existing, detail, now);
    }

    private ScriptDefinition buildBaseScriptDefinition(String scriptId, RepositoryToolDetail detail, String repositoryId) {
        ScriptPackaging packaging = catalog.resolvePackaging(detail.descriptor().packaging());
        Map<String, Object> inputSchema = catalog.readSchema(repositoryId, detail.descriptor().inputSchemaPath());
        Map<String, Object> outputSchema = catalog.readSchema(repositoryId, detail.descriptor().outputSchemaPath());
        return new ScriptDefinition()
                .setId(scriptId)
                .setName(detail.descriptor().displayName())
                .setType(ScriptType.valueOf(detail.descriptor().type()))
                .setPackaging(packaging)
                .setSource(detail.source())
                .setPythonRequirements(detail.pythonRequirements())
                .setInputSchema(inputSchema)
                .setOutputSchema(outputSchema)
                .setStatus(ScriptStatus.PUBLISHED)
                .setPublishedSnapshot(new PublishedScriptSnapshot()
                        .setName(detail.descriptor().displayName())
                        .setType(ScriptType.valueOf(detail.descriptor().type()))
                        .setPackaging(packaging)
                        .setSource(detail.source())
                        .setPythonRequirements(detail.pythonRequirements())
                        .setInputSchema(inputSchema)
                        .setOutputSchema(outputSchema)
                        .setScriptDependencies(detail.descriptor().scriptDependencies()))
                .setRepositoryId(repositoryId)
                .setRepositoryToolId(detail.descriptor().toolId())
                .setRepositoryVersion(detail.descriptor().version())
                .setOwner(detail.descriptor().owner())
                .setDescription(detail.descriptor().description())
                .setTags(detail.descriptor().tags())
                .setScriptDependencies(detail.descriptor().scriptDependencies())
                .setPluginDependencies(detail.descriptor().pluginDependencies());
    }

    private ScriptDefinition buildInstalledScriptDefinition(String repositoryId,
                                                             RepositoryToolDetail detail,
                                                             ScriptDefinition existing,
                                                             LocalDateTime now) {
        return applyLifecycle(buildBaseScriptDefinition(detail.descriptor().installedScriptId(), detail, repositoryId),
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
        for (ScriptDependency dependency : nullSafeList(dependencies)) {
            String scriptId = SkillFileUtils.normalize(dependency.getScriptId(), "脚本依赖 scriptId 不能为空");
            String depRepositoryId = SkillFileUtils.normalize(dependency.getRepositoryId(), "脚本依赖 repositoryId 不能为空: " + scriptId);
            String depToolId = SkillFileUtils.normalize(dependency.getToolId(), "脚本依赖 toolId 不能为空: " + scriptId);
            ScriptDefinition installed = repos.scriptRepository().findInstalledByRepositorySource(depRepositoryId, depToolId).orElse(null);
            if (installed != null && RepositoryVersionUtils.versionSatisfies(installed.getRepositoryVersion(), dependency.getVersionRange())) {
                continue;
            }
            if (!installScriptDependencies) {
                throw new IllegalArgumentException(
                        "缺少脚本依赖或版本不满足: " + scriptId + " -> " + depRepositoryId + "/" + depToolId + " "
                                + SkillFileUtils.normalizeOrDefault(dependency.getVersionRange(), "")
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

    private void syncScheduleTemplates(ScriptDefinition definition, List<ScheduleTemplateItem> templates) {
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
                    .setCreatedAt(existing == null ? LocalDateTime.now() : existing.getCreatedAt())
                    .setUpdatedAt(LocalDateTime.now());
            repos.scriptScheduleRepository().save(schedule);
        }
    }

    private ScriptDefinition saveDevelopmentScript(String scriptId,
                                                   ScriptDefinition existing,
                                                   RepositoryToolDetail detail,
                                                   ToolSourceState state) {
        ScriptDefinition def = buildDevelopmentScriptDefinition(scriptId, existing, detail, state);
        return repos.scriptRepository().save(def);
    }

    private ScriptDefinition buildDevelopmentScriptDefinition(String scriptId,
                                                               ScriptDefinition existing,
                                                               RepositoryToolDetail detail,
                                                               ToolSourceState state) {
        LocalDateTime now = LocalDateTime.now();
        return applyLifecycle(buildBaseScriptDefinition(scriptId, detail, detail.descriptor().repositoryId()),
                existing, ScriptScope.DEVELOPMENT, true, now)
                .setVersion(existing == null ? 1 : existing.getVersion())
                .setSourcePath(state.path())
                .setSourceCommit(state.commit())
                .setSourceDigest(state.digest())
                .setSourceSyncedAt(now)
                .setDirty(false);
    }

    private static ScriptDefinition applyLifecycle(ScriptDefinition def, ScriptDefinition existing,
                                                    ScriptScope scope, boolean editable, LocalDateTime now) {
        return def.setScope(scope)
                .setEditable(editable)
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now);
    }
}
