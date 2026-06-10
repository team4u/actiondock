package org.team4u.actiondock.repository;

import org.team4u.actiondock.common.NormalizeUtils;

import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiModelProvider;
import org.team4u.actiondock.ai.api.AiProvider;
import org.team4u.actiondock.ai.api.AiToolPermission;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.domain.model.CapabilityPackageInstallation;
import org.team4u.actiondock.domain.model.ExecutionPreset;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookRelatedRef;
import org.team4u.actiondock.domain.model.PlaybookRelatedRefRelation;
import org.team4u.actiondock.domain.model.PlaybookScriptRef;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * 仓库能力包安装、更新、卸载和发布服务。
 * <p>
 * 从 {@link RepositoryCatalogService} 中提取，负责能力包从仓库的安装、升级、卸载和发布操作。
 * 安装/更新核心逻辑在本类中实现，其余操作委托给 {@link RepositoryCatalogService} 的 package-private 方法。
 *
 * @author jay.wu
 */
public class RepositoryCapabilityPackageService {

    private static final System.Logger log = System.getLogger(RepositoryCapabilityPackageService.class.getName());

    private final RepositoryCatalogService catalog;
    private final RepositoryCatalogService.Repositories repos;
    private final RepositoryCatalogService.ApplicationServices services;
    private final RepositoryPluginService pluginService;
    private final RepositoryScriptService toolService;
    private final RepositoryConfigTemplateSyncService configTemplateSyncService;
    private final RepositoryAiPackageService aiPackageService;
    private final RepositoryDependencyResolver dependencyResolver;

    public RepositoryCapabilityPackageService(RepositoryCatalogService catalog,
                                               RepositoryCatalogService.Repositories repos,
                                               RepositoryCatalogService.ApplicationServices services,
                                               RepositoryPluginService pluginService,
                                               RepositoryScriptService toolService,
                                               RepositoryConfigTemplateSyncService configTemplateSyncService,
                                               RepositoryAiPackageService aiPackageService) {
        this.catalog = catalog;
        this.repos = repos;
        this.services = services;
        this.pluginService = pluginService;
        this.toolService = toolService;
        this.configTemplateSyncService = configTemplateSyncService;
        this.aiPackageService = aiPackageService;
        this.dependencyResolver = new RepositoryDependencyResolver(catalog);
        catalog.setCapabilityPackageService(this);
    }

    public CapabilityPackagePublishPreview previewCapabilityPackage(String repositoryId,
                                                                                              RepositoryCatalogTypes.CapabilityPackagePublishRequest request) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        CapabilityPackageDraft draft = aiPackageService.buildCapabilityPackageDraft(repository, request);
        return aiPackageService.buildCapabilityPackagePublishPreview(repository, draft);
    }

    public CapabilityPackageDescriptor publishCapabilityPackage(String repositoryId,
                                                                                         CapabilityPackagePublishRequest request) {
        WritableRepositorySession session = catalog.openWritableRepositorySession(repositoryId);
        RepositoryDefinition repository = session.repository();
        CapabilityPackageDraft draft = aiPackageService.buildCapabilityPackageDraft(repository, request);
        CapabilityPackagePublishPreview preview = aiPackageService.buildCapabilityPackagePublishPreview(repository, draft);
        if (preview.checks().stream().anyMatch(item -> CHECK_SEVERITY_BLOCKER.equals(item.severity()))) {
            throw new IllegalArgumentException("能力包存在阻断项，不能发布");
        }
        RepositoryCatalogTypes.assertCapabilityPackageVersionAvailable(repositoryId, session.index(), draft.packageId(), draft.version());
        java.nio.file.Path packageRoot = session.root().resolve(CAPABILITY_PACKAGES_DIR).resolve(draft.packageId());
        aiPackageService.writeCapabilityPackageFiles(packageRoot, draft);
        session.commitPublishedAsset(draft.packageId(), draft.version(), draft.releaseNotes());
        catalog.refreshRepositoryCache(repositoryId);
        return catalog.getCapabilityPackage(repositoryId, draft.packageId()).descriptor();
    }

    public CapabilityPackageInstallResult installCapabilityPackage(String repositoryId, String packageId) {
        return installOrUpdateCapabilityPackage(repositoryId, packageId, false, new LinkedHashSet<>());
    }

    public CapabilityPackageInstallResult updateCapabilityPackage(String repositoryId, String packageId) {
        return installOrUpdateCapabilityPackage(repositoryId, packageId, true, new LinkedHashSet<>());
    }

    public void uninstallCapabilityPackage(String repositoryId, String packageId) {
        CapabilityPackageInstallation installation = repos.capabilityPackageInstallationRepository()
                .findByInstallationId(RepositoryCatalogTypes.capabilityPackageInstallationId(repositoryId, packageId))
                .orElseThrow(() -> new IllegalArgumentException("能力包尚未安装: " + packageId));
        uninstallCapabilityPackage(installation);
    }

    public void uninstallCapabilityPackageByInstallationId(String installationId) {
        CapabilityPackageInstallation installation = repos.capabilityPackageInstallationRepository()
                .findByInstallationId(NormalizeUtils.normalize(installationId, "installationId 不能为空"))
                .orElseThrow(() -> new IllegalArgumentException("能力包尚未安装: " + installationId));
        uninstallCapabilityPackage(installation);
    }

    private void uninstallCapabilityPackage(CapabilityPackageInstallation installation) {
        validateCapabilityPackageUninstall(installation);
        catalog.uninstallManagedCapabilityPackageAssets(installation);
        for (String presetId : installation.getPresetIds()) {
            repos.executionPresetRepository().deleteById(presetId);
        }
        repos.capabilityPackageInstallationRepository().deleteByInstallationId(installation.getInstallationId());
        configTemplateSyncService.removeManagedConfigTemplates(installation.getRepositoryId(), installation.getPackageId());
    }

    /**
     * 安装或更新能力包。
     * <p>
     * 递归处理能力包依赖（AI_PACKAGE、TOOL、PLUGIN），创建运行时资源
     * （模型 Profile、工具集、Agent Profile、脚本、调度、预设、配置模板），
     * 并持久化安装记录。
     *
     * @param repositoryId 仓库 ID
     * @param packageId    能力包 ID
     * @param updateOnly   是否仅更新（true 时要求已安装）
     * @param visiting     正在访问的安装 ID 集合，用于检测循环依赖
     * @return 安装结果，包含安装记录和解析后的外部依赖
     */
    private CapabilityPackageInstallResult installOrUpdateCapabilityPackage(String repositoryId,
                                                                            String packageId,
                                                                            boolean updateOnly,
                                                                            LinkedHashSet<String> visiting) {
        String installationId = RepositoryCatalogTypes.capabilityPackageInstallationId(repositoryId, packageId);
        if (!visiting.add(installationId)) {
            throw new IllegalStateException("检测到能力包循环依赖: " + String.join(" -> ", visiting) + " -> " + installationId);
        }
        try {
            CapabilityPackageInstallation existing = findExistingOrThrow(installationId, packageId, updateOnly);
            if (existing != null) {
                validateCapabilityPackageUninstall(existing);
            }
            CapabilityPackageDetail detail = catalog.getCapabilityPackage(repositoryId, packageId);
            resolveExternalDependencies(repositoryId, detail.releaseFile().externalDependencies(), visiting);
            uninstallExistingAssets(existing);
            return installPackageAssets(repositoryId, packageId, detail, existing);
        } finally {
            visiting.remove(installationId);
        }
    }

    private CapabilityPackageInstallation findExistingOrThrow(String installationId, String packageId, boolean updateOnly) {
        CapabilityPackageInstallation existing = repos.capabilityPackageInstallationRepository()
                .findByInstallationId(installationId)
                .orElse(null);
        if (updateOnly && existing == null) {
            throw new IllegalArgumentException("能力包尚未安装: " + packageId);
        }
        return existing;
    }

    private CapabilityPackageInstallResult installPackageAssets(String repositoryId,
                                                                 String packageId,
                                                                 CapabilityPackageDetail detail,
                                                                 CapabilityPackageInstallation existing) {
        InstallationContext ctx = buildInstallationContext(repositoryId, packageId, detail.releaseFile());
        InstalledAssets assets = installAllAssets(detail, ctx);
        configTemplateSyncService.syncConfigTemplates(repositoryId, packageId, detail.descriptor().version(), detail.configTemplate());
        String installationId = RepositoryCatalogTypes.capabilityPackageInstallationId(repositoryId, packageId);
        return persistInstallationRecord(installationId, repositoryId, packageId, detail, existing, ctx, assets);
    }

    private record InstalledAssets(
            List<String> modelIds,
            List<String> toolsetIds,
            List<String> scriptIds,
            List<String> agentIds,
            List<String> scheduleIds,
            List<String> presetIds,
            List<String> playbookIds
    ) {}

    private InstalledAssets installAllAssets(CapabilityPackageDetail detail, InstallationContext ctx) {
        return new InstalledAssets(
                installModels(ctx),
                installToolsets(ctx),
                installScripts(ctx),
                installAgents(ctx),
                installSchedules(detail, ctx),
                installPresets(detail, ctx),
                installPlaybooks(ctx)
        );
    }

    private CapabilityPackageInstallResult persistInstallationRecord(String installationId,
                                                                      String repositoryId,
                                                                      String packageId,
                                                                      CapabilityPackageDetail detail,
                                                                      CapabilityPackageInstallation existing,
                                                                      InstallationContext ctx,
                                                                      InstalledAssets assets) {
        String runtimeEntryId = RepositoryCatalogTypes.resolveRuntimeEntry(detail.releaseFile().entries(), ctx.agentIdMappings, ctx.scriptIdMappings);
        CapabilityPackageInstallation installation = new CapabilityPackageInstallation()
                .setInstallationId(installationId)
                .setRepositoryId(repositoryId)
                .setPackageId(packageId)
                .setName(detail.descriptor().displayName())
                .setVersion(detail.descriptor().version())
                .setLatestVersion(detail.descriptor().version())
                .setEntryAgentId(runtimeEntryId)
                .setOwner(detail.descriptor().owner())
                .setDescription(detail.descriptor().description())
                .setModelIds(assets.modelIds())
                .setToolsetIds(assets.toolsetIds())
                .setAgentIds(assets.agentIds())
                .setScriptIds(assets.scriptIds())
                .setScheduleIds(assets.scheduleIds())
                .setPresetIds(assets.presetIds())
                .setPlaybookIds(assets.playbookIds())
                .setInstalledAt(existing == null ? ctx.now : Optional.ofNullable(existing.getInstalledAt()).orElse(ctx.now))
                .setUpdatedAt(ctx.now);
        return new CapabilityPackageInstallResult(
                repos.capabilityPackageInstallationRepository().save(installation),
                NormalizeUtils.nullSafeList(ctx.release.externalDependencies())
        );
    }

    private void resolveExternalDependencies(String repositoryId,
                                             List<RepositoryAiPackageDependency> dependencies,
                                             LinkedHashSet<String> visiting) {
        for (RepositoryAiPackageDependency dependency : NormalizeUtils.nullSafeList(dependencies)) {
            DependencyAssetType type = DependencyAssetType.fromString(dependency.assetType());
            switch (type) {
                case AI_PACKAGE -> resolveAiPackageDependency(repositoryId, dependency, visiting);
                case TOOL -> resolveToolDependency(repositoryId, dependency);
                case PLUGIN -> resolvePluginDependency(repositoryId, dependency);
            }
        }
    }

    private void resolveAiPackageDependency(String repositoryId,
                                            RepositoryAiPackageDependency dependency,
                                            LinkedHashSet<String> visiting) {
        String dependencyRepositoryId = dependencyResolver.resolveCapabilityPackageRepositoryId(repositoryId, dependency.repositoryId(), dependency.assetId());
        String dependencyInstallationId = RepositoryCatalogTypes.capabilityPackageInstallationId(dependencyRepositoryId, dependency.assetId());
        boolean alreadyInstalled = repos.capabilityPackageInstallationRepository().findByInstallationId(dependencyInstallationId).isPresent();
        installOrUpdateCapabilityPackage(dependencyRepositoryId, dependency.assetId(), alreadyInstalled, visiting);
    }

    private void resolveToolDependency(String repositoryId, RepositoryAiPackageDependency dependency) {
        String dependencyRepositoryId = dependencyResolver.resolveToolRepositoryId(repositoryId, dependency.repositoryId(), dependency.assetId());
        if (repos.repositoryLocalAssetRepository()
                .findByUpstreamAsset(UpstreamAssetType.SCRIPT, dependencyRepositoryId, dependency.assetId())
                .isPresent()) {
            toolService.updateLocalAsset(dependencyRepositoryId, dependency.assetId(), ToolInstallationOptions.DEFAULT);
        } else {
            toolService.addLocalAsset(dependencyRepositoryId, dependency.assetId(),
                    new RepositoryLocalAssetRequest("LOCKED", null, false, false, false, false));
        }
    }

    private void resolvePluginDependency(String repositoryId, RepositoryAiPackageDependency dependency) {
        PluginRegistration registration = findExistingPluginRegistration(dependency.assetId());
        if (registration != null
                && NormalizeUtils.isBlank(dependency.repositoryId())
                && Objects.equals(registration.getRepositoryPluginId(), dependency.assetId())) {
            return;
        }
        String dependencyRepositoryId = dependencyResolver.resolvePluginRepositoryId(repositoryId, dependency.repositoryId(), dependency.assetId());
        if (registration == null) {
            if (NormalizeUtils.isBlank(dependencyRepositoryId)) {
                throw new IllegalArgumentException("缺少插件仓库来源，且本地未安装插件: " + dependency.assetId());
            }
            pluginService.installPlugin(dependencyRepositoryId, dependency.assetId(), false);
        } else if (!Objects.equals(registration.getRepositoryId(), dependencyRepositoryId)
                || !Objects.equals(registration.getRepositoryPluginId(), dependency.assetId())) {
            pluginService.installPlugin(dependencyRepositoryId, dependency.assetId(), false);
        }
    }

    private PluginRegistration findExistingPluginRegistration(String pluginId) {
        try {
            return services.pluginRuntimeService().getRegistration(pluginId);
        } catch (IllegalArgumentException exception) {
            log.log(System.Logger.Level.WARNING, "插件注册信息查询失败: {0}", exception.getMessage());
            return null;
        }
    }

    private void uninstallExistingAssets(CapabilityPackageInstallation existing) {
        if (existing == null) {
            return;
        }
        catalog.uninstallManagedCapabilityPackageAssets(existing);
        for (String presetId : existing.getPresetIds()) {
            repos.executionPresetRepository().deleteById(presetId);
        }
        configTemplateSyncService.removeManagedConfigTemplates(existing.getRepositoryId(), existing.getPackageId());
    }

    private record InstallationContext(
            String repositoryId,
            String packageId,
            LocalDateTime now,
            CapabilityPackageReleaseFile release,
            Map<String, String> modelIdMappings,
            Map<String, String> toolsetIdMappings,
            Map<String, String> agentIdMappings,
            Map<String, String> scriptIdMappings,
            Map<String, String> playbookIdMappings
    ) {}

    private static InstallationContext buildInstallationContext(String repositoryId,
                                                                String packageId,
                                                                CapabilityPackageReleaseFile release) {
        Map<String, String> modelIdMappings = new LinkedHashMap<>();
        Map<String, String> toolsetIdMappings = new LinkedHashMap<>();
        Map<String, String> agentIdMappings = new LinkedHashMap<>();
        Map<String, String> scriptIdMappings = new LinkedHashMap<>();
        for (AiPackageModelFile model : NormalizeUtils.nullSafeList(release == null ? null : release.models())) {
            modelIdMappings.put(model.id(), RepositoryCatalogTypes.aiPackageInternalId(repositoryId, packageId, "model", model.id()));
        }
        for (AiPackageToolsetFile toolset : NormalizeUtils.nullSafeList(release == null ? null : release.toolsets())) {
            toolsetIdMappings.put(toolset.id(), RepositoryCatalogTypes.aiPackageInternalId(repositoryId, packageId, "toolset", toolset.id()));
        }
        for (AiPackageAgentFile agent : NormalizeUtils.nullSafeList(release == null ? null : release.agents())) {
            agentIdMappings.put(agent.id(), RepositoryCatalogTypes.aiPackageInternalId(repositoryId, packageId, "agent", agent.id()));
        }
        for (AiPackageScriptFile script : NormalizeUtils.nullSafeList(release == null ? null : release.scripts())) {
            scriptIdMappings.put(script.id(), RepositoryCatalogTypes.aiPackageInternalId(repositoryId, packageId, "script", script.id()));
        }
        Map<String, String> playbookIdMappings = new LinkedHashMap<>();
        for (Playbook playbook : NormalizeUtils.nullSafeList(release == null ? null : release.playbooks())) {
            playbookIdMappings.put(playbook.getId(), RepositoryCatalogTypes.aiPackageInternalId(repositoryId, packageId, "playbook", playbook.getId()));
        }
        return new InstallationContext(repositoryId, packageId, LocalDateTime.now(),
                release, modelIdMappings, toolsetIdMappings, agentIdMappings, scriptIdMappings,
                playbookIdMappings);
    }

    private List<String> installModels(InstallationContext ctx) {
        List<String> installedIds = new ArrayList<>();
        for (AiPackageModelFile model : NormalizeUtils.nullSafeList(ctx.release == null ? null : ctx.release.models())) {
            AiModelProfile profile = new AiModelProfile()
                    .setId(ctx.modelIdMappings.get(model.id()))
                    .setName(model.name())
                    .setProvider(model.provider() == null ? AiProvider.AGENTSCOPE : AiProvider.valueOf(model.provider()))
                    .setModelProvider(model.modelProvider() == null ? null : AiModelProvider.valueOf(model.modelProvider()))
                    .setModelName(model.modelName())
                    .setBaseUrl(model.baseUrl())
                    .setApiKeyConfigKey(model.apiKeyConfigKey())
                    .setDefaultOptions(model.defaultOptions() == null ? Map.of() : model.defaultOptions())
                    .setLimits(model.limits() == null ? Map.of() : model.limits())
                    .setCapabilities(AiPackageIdRewriter.readCapabilities(model.capabilities()))
                    .setEnabled(model.enabled())
                    .setCreatedAt(ctx.now)
                    .setUpdatedAt(ctx.now);
            repos.aiModelProfileRepository().save(profile);
            installedIds.add(profile.getId());
        }
        return installedIds;
    }

    private List<String> installToolsets(InstallationContext ctx) {
        List<String> installedIds = new ArrayList<>();
        for (AiPackageToolsetFile toolset : NormalizeUtils.nullSafeList(ctx.release == null ? null : ctx.release.toolsets())) {
            List<String> toolNames = NormalizeUtils.nullSafeList(toolset.toolNames()).stream()
                    .map(toolName -> AiPackageIdRewriter.rewriteToolName(toolName, ctx.agentIdMappings, ctx.scriptIdMappings))
                    .toList();
            AiToolset value = new AiToolset()
                    .setId(ctx.toolsetIdMappings.get(toolset.id()))
                    .setName(toolset.name())
                    .setDescription(toolset.description())
                    .setToolNames(toolNames)
                    .setToolOptions(AiPackageIdRewriter.rewriteToolOptions(toolset.toolOptions(), ctx.agentIdMappings, ctx.scriptIdMappings))
                    .setMaxPermission(toolset.maxPermission() == null
                            ? AiToolPermission.READ_ONLY
                            : AiToolPermission.valueOf(toolset.maxPermission()))
                    .setEnabled(toolset.enabled())
                    .setCreatedAt(ctx.now)
                    .setUpdatedAt(ctx.now);
            repos.aiToolsetRepository().save(value);
            installedIds.add(value.getId());
        }
        return installedIds;
    }

    private List<String> installScripts(InstallationContext ctx) {
        List<String> installedIds = new ArrayList<>();
        for (AiPackageScriptFile script : NormalizeUtils.nullSafeList(ctx.release == null ? null : ctx.release.scripts())) {
            String runtimeScriptId = ctx.scriptIdMappings.get(script.id());
            ScriptDefinition definition = new ScriptDefinition()
                    .setId(runtimeScriptId)
                    .setName(script.name())
                    .setType(script.type() == null ? ScriptType.GROOVY : ScriptType.valueOf(script.type()))
                    .setPackaging(script.packaging() == null ? ScriptPackaging.TOOL : ScriptPackaging.valueOf(script.packaging()))
                    .setSource(AiPackageIdRewriter.rewriteScriptSource(script.source(), ctx.scriptIdMappings, ctx.modelIdMappings, ctx.agentIdMappings))
                    .setPythonRequirements(script.pythonRequirements())
                    .setInputSchema(script.inputSchema() == null ? Map.of() : script.inputSchema())
                    .setOutputSchema(script.outputSchema() == null ? Map.of() : script.outputSchema())
                    .setAiDependencies(AiPackageIdRewriter.rewriteAiDependencies(script.aiDependencies(), ctx.modelIdMappings, ctx.agentIdMappings))
                    .setVersion(1)
                    .setEditable(false)
                    .setDescription(script.description())
                    .setTags(script.tags())
                    .setPluginDependencies(script.pluginDependencies())
                    .setCreatedAt(ctx.now)
                    .setUpdatedAt(ctx.now);
            definition.setPublishedRevision(org.team4u.actiondock.domain.model.PublishedScriptRevision.fromDraft(
                    definition,
                    runtimeScriptId + ":published:1",
                    1,
                    ctx.now
            ));
            repos.scriptRepository().save(definition);
            installedIds.add(runtimeScriptId);
        }
        return installedIds;
    }

    private List<String> installAgents(InstallationContext ctx) {
        List<String> installedIds = new ArrayList<>();
        for (AiPackageAgentFile agent : NormalizeUtils.nullSafeList(ctx.release == null ? null : ctx.release.agents())) {
            String runtimeAgentId = ctx.agentIdMappings.get(agent.id());
            AiAgentProfile profile = new AiAgentProfile()
                    .setId(runtimeAgentId)
                    .setName(agent.name())
                    .setDescription(agent.description())
                    .setProvider(agent.provider() == null ? AiProvider.AGENTSCOPE : AiProvider.valueOf(agent.provider()))
                    .setModelProfileId(ctx.modelIdMappings.getOrDefault(agent.modelProfileId(), agent.modelProfileId()))
                    .setSystemPrompt(agent.systemPrompt())
                    .setToolsetIds(NormalizeUtils.nullSafeList(agent.toolsetIds()).stream()
                            .map(toolsetId -> ctx.toolsetIdMappings.getOrDefault(toolsetId, toolsetId))
                            .toList())
                    .setDirectToolNames(NormalizeUtils.nullSafeList(agent.directToolNames()).stream()
                            .map(toolName -> AiPackageIdRewriter.rewriteToolName(toolName, ctx.agentIdMappings, ctx.scriptIdMappings))
                            .toList())
                    .setDirectToolOptions(AiPackageIdRewriter.rewriteToolOptions(agent.directToolOptions(), ctx.agentIdMappings, ctx.scriptIdMappings))
                    .setSkillIds(NormalizeUtils.nullSafeList(agent.skillIds()))
                    .setOptions(agent.options() == null ? Map.of() : agent.options())
                    .setEnabled(agent.enabled())
                    .setCreatedAt(ctx.now)
                    .setUpdatedAt(ctx.now);
            repos.aiAgentProfileRepository().save(profile);
            installedIds.add(runtimeAgentId);
        }
        return installedIds;
    }

    private List<String> installSchedules(CapabilityPackageDetail detail, InstallationContext ctx) {
        List<String> installedIds = new ArrayList<>();
        for (ScheduleTemplateItem template : detail.scheduleTemplate()) {
            String runtimeScriptId = ctx.scriptIdMappings.get(template.scriptId());
            if (runtimeScriptId == null) {
                continue;
            }
            ScriptSchedule schedule = new ScriptSchedule()
                    .setId(UUID.randomUUID().toString())
                    .setScriptId(runtimeScriptId)
                    .setName(template.name())
                    .setCronExpression(template.cronExpression())
                    .setInput(template.input() == null ? Map.of() : template.input())
                    .setEnabled(template.enabledByDefault())
                    .setEditable(false)
                    .setRepositoryId(ctx.repositoryId)
                    .setRepositoryToolId(runtimeScriptId)
                    .setRepositoryPackageId(ctx.packageId)
                    .setRepositoryVersion(detail.descriptor().version())
                    .setCreatedAt(ctx.now)
                    .setUpdatedAt(ctx.now);
            repos.scriptScheduleRepository().save(schedule);
            installedIds.add(schedule.getId());
        }
        return installedIds;
    }

    private List<String> installPresets(CapabilityPackageDetail detail, InstallationContext ctx) {
        List<String> installedIds = new ArrayList<>();
        for (CapabilityPackagePresetTemplate template : detail.presetTemplate()) {
            String runtimeScriptId = ctx.scriptIdMappings.get(template.scriptId());
            if (runtimeScriptId == null) {
                continue;
            }
            ExecutionPreset preset = new ExecutionPreset()
                    .setId(UUID.randomUUID().toString())
                    .setScriptId(runtimeScriptId)
                    .setName(template.name())
                    .setInput(template.input() == null ? Map.of() : template.input())
                    .setManaged(true)
                    .setEditable(false)
                    .setRepositoryId(ctx.repositoryId)
                    .setRepositoryPackageId(ctx.packageId)
                    .setRepositoryVersion(detail.descriptor().version())
                    .setCreatedAt(ctx.now)
                    .setUpdatedAt(ctx.now);
            repos.executionPresetRepository().save(preset);
            installedIds.add(preset.getId());
        }
        return installedIds;
    }

    private List<String> installPlaybooks(InstallationContext ctx) {
        List<String> installedIds = new ArrayList<>();
        List<Playbook> playbooksToSave = new ArrayList<>();

        for (Playbook playbook : NormalizeUtils.nullSafeList(ctx.release == null ? null : ctx.release.playbooks())) {
            String runtimePlaybookId = ctx.playbookIdMappings.get(playbook.getId());

            List<PlaybookRelatedRef> rewrittenRelatedRefs = new ArrayList<>();
            for (PlaybookRelatedRef ref : NormalizeUtils.nullSafeList(playbook.getRelatedPlaybookRefs())) {
                String originalRefId = ref.getPlaybookId();
                String targetPlaybookId;
                if (ctx.playbookIdMappings.containsKey(originalRefId)) {
                    targetPlaybookId = ctx.playbookIdMappings.get(originalRefId);
                } else {
                    targetPlaybookId = originalRefId;
                    if (repos.playbookRepository().findById(targetPlaybookId).isEmpty()) {
                        throw org.team4u.actiondock.domain.exception.ActionDockException.notFound(
                                org.team4u.actiondock.domain.exception.ActionDockErrorCodes.PLAYBOOK_NOT_FOUND,
                                "关联任务手册不存在: " + targetPlaybookId,
                                Map.of("playbookId", targetPlaybookId)
                        );
                    }
                }
                rewrittenRelatedRefs.add(new PlaybookRelatedRef()
                        .setPlaybookId(targetPlaybookId)
                        .setRelation(ref.getRelation() == null ? PlaybookRelatedRefRelation.RELATED : ref.getRelation())
                        .setPurpose(ref.getPurpose()));
            }

            Playbook value = new Playbook()
                    .setId(runtimePlaybookId)
                    .setName(playbook.getName())
                    .setDescription(playbook.getDescription())
                    .setTags(playbook.getTags())
                    .setRiskLevel(playbook.getRiskLevel())
                    .setRepositoryIds(playbook.getRepositoryIds())
                    .setKnowledgeRefs(playbook.getKnowledgeRefs())
                    .setScriptRefs(rewritePlaybookScriptRefs(playbook.getScriptRefs(), ctx.scriptIdMappings))
                    .setAgentSkillRefs(playbook.getAgentSkillRefs())
                    .setRelatedPlaybookRefs(rewrittenRelatedRefs)
                    .setGuideMarkdown(playbook.getGuideMarkdown())
                    .setStopConditions(playbook.getStopConditions())
                    .setEnabled(playbook.isEnabled())
                    .setManaged(true)
                    .setCreatedAt(ctx.now)
                    .setUpdatedAt(ctx.now);
            playbooksToSave.add(value);
        }

        for (Playbook value : playbooksToSave) {
            repos.playbookRepository().save(value);
            installedIds.add(value.getId());
        }

        return installedIds;
    }

    private List<PlaybookScriptRef> rewritePlaybookScriptRefs(List<PlaybookScriptRef> refs, Map<String, String> scriptIdMappings) {
        return NormalizeUtils.nullSafeList(refs).stream()
                .map(ref -> new PlaybookScriptRef()
                        .setScriptId(scriptIdMappings.getOrDefault(ref.getScriptId(), ref.getScriptId()))
                        .setPurpose(ref.getPurpose()))
                .toList();
    }

    private void validateCapabilityPackageUninstall(CapabilityPackageInstallation installation) {
        List<String> playbookIdsBeingRemoved = NormalizeUtils.nullSafeList(installation.getPlaybookIds());
        if (playbookIdsBeingRemoved.isEmpty()) {
            return;
        }
        List<Playbook> allPlaybooks = repos.playbookRepository().findAll();
        List<String> referencingPlaybookIds = allPlaybooks.stream()
                .filter(p -> !playbookIdsBeingRemoved.contains(p.getId()))
                .filter(p -> NormalizeUtils.nullSafeList(p.getRelatedPlaybookRefs()).stream()
                        .anyMatch(ref -> playbookIdsBeingRemoved.contains(ref.getPlaybookId())))
                .map(Playbook::getId)
                .toList();
        if (!referencingPlaybookIds.isEmpty()) {
            throw org.team4u.actiondock.domain.exception.ActionDockException.conflict(
                    org.team4u.actiondock.domain.exception.ActionDockErrorCodes.PLAYBOOK_IN_USE,
                    "无法删除或卸载能力包，因为其中的任务手册被包外任务手册引用",
                    Map.of("referencingPlaybookIds", referencingPlaybookIds)
            );
        }
    }

}
