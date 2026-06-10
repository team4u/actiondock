package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.CapabilityPackageInstallation;
import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiCapability;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.ai.tool.ActionDockDynamicAiToolProvider;
import org.team4u.actiondock.domain.model.AiDependency;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.port.CapabilityPackageInstallationRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.common.NormalizeUtils;

import java.util.List;
import java.util.function.Supplier;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

/**
 * AI 能力包依赖收集器，负责递归收集 Agent、模型、工具集、脚本、插件等依赖。
 *
 * @author jay.wu
 */
class AiPackageDependencyCollector {

    private static final System.Logger log = System.getLogger(AiPackageDependencyCollector.class.getName());

    private final AiAgentProfileRepository aiAgentProfileRepository;
    private final AiModelProfileRepository aiModelProfileRepository;
    private final AiToolsetRepository aiToolsetRepository;
    private final CapabilityPackageInstallationRepository capabilityPackageInstallationRepository;
    private final ScriptRepository scriptRepository;
    private final ScriptApplicationService scriptApplicationService;
    private final PluginRuntimeService pluginRuntimeService;

    AiPackageDependencyCollector(AiAgentProfileRepository aiAgentProfileRepository,
                                 AiModelProfileRepository aiModelProfileRepository,
                                 AiToolsetRepository aiToolsetRepository,
                                 CapabilityPackageInstallationRepository capabilityPackageInstallationRepository,
                                 ScriptRepository scriptRepository,
                                 ScriptApplicationService scriptApplicationService,
                                 PluginRuntimeService pluginRuntimeService) {
        this.aiAgentProfileRepository = aiAgentProfileRepository;
        this.aiModelProfileRepository = aiModelProfileRepository;
        this.aiToolsetRepository = aiToolsetRepository;
        this.capabilityPackageInstallationRepository = capabilityPackageInstallationRepository;
        this.scriptRepository = scriptRepository;
        this.scriptApplicationService = scriptApplicationService;
        this.pluginRuntimeService = pluginRuntimeService;
    }

    void collectAgentDependency(RepositoryDefinition repository,
                                AiPackageBundleBuilder builder,
                                String agentId,
                                boolean entryPoint) {
        if (NormalizeUtils.isBlank(agentId)) return;
        if (builder.hasAgent(agentId) || builder.isExternalAgent(agentId)) return;

        CapabilityPackageInstallation packageInstallation = capabilityPackageInstallationRepository
                .findByEntryAgentId(agentId)
                .orElse(null);
        if (packageInstallation != null) {
            builder.addExternalDependency(new RepositoryAiPackageDependency(
                    DependencyAssetType.AI_PACKAGE.name(),
                    packageInstallation.getRepositoryId(),
                    packageInstallation.getPackageId(),
                    packageInstallation.getVersion()
            ));
            return;
        }

        AiAgentProfile profile = collectDependency(agentId, "Agent",
                () -> aiAgentProfileRepository.findById(agentId)
                        .orElseThrow(() -> new IllegalArgumentException("AI Agent Profile 不存在: " + agentId)));

        builder.addAgent(entryPoint ? builder.entryAgentId() : profile.getId(), toAiPackageAgentFile(profile));
        collectModelDependency(builder, profile.getModelProfileId());
        for (String toolsetId : profile.getToolsetIds()) {
            collectToolsetDependency(repository, builder, toolsetId);
        }
        for (String toolName : profile.getDirectToolNames()) {
            collectToolNameDependency(repository, builder, toolName);
        }
    }

    void collectModelDependency(AiPackageBundleBuilder builder, String modelProfileId) {
        if (NormalizeUtils.isBlank(modelProfileId) || builder.hasModel(modelProfileId)) return;

        AiModelProfile profile = collectDependency(modelProfileId, "模型",
                () -> aiModelProfileRepository.findById(modelProfileId)
                        .orElseThrow(() -> new IllegalArgumentException("AI 模型 Profile 不存在: " + modelProfileId)));

        builder.addModel(profile.getId(), toAiPackageModelFile(profile));
    }

    void collectToolsetDependency(RepositoryDefinition repository,
                                  AiPackageBundleBuilder builder,
                                  String toolsetId) {
        if (NormalizeUtils.isBlank(toolsetId) || builder.hasToolset(toolsetId)) return;

        AiToolset toolset = collectDependency(toolsetId, "工具集",
                () -> aiToolsetRepository.findById(toolsetId)
                        .orElseThrow(() -> new IllegalArgumentException("AI 工具集不存在: " + toolsetId)));

        builder.addToolset(toolset.getId(), toAiPackageToolsetFile(toolset));
        for (String toolName : toolset.getToolNames()) {
            collectToolNameDependency(repository, builder, toolName);
        }
    }

    void collectToolNameDependency(RepositoryDefinition repository,
                                   AiPackageBundleBuilder builder,
                                   String toolName) {
        if (NormalizeUtils.isBlank(toolName)) {
            return;
        }
        if (toolName.startsWith(ActionDockDynamicAiToolProvider.SCRIPT_TOOL_PREFIX)) {
            collectScriptDependency(repository, builder, toolName.substring(ActionDockDynamicAiToolProvider.SCRIPT_TOOL_PREFIX.length()));
            return;
        }
        if (toolName.startsWith(ActionDockDynamicAiToolProvider.AGENT_TOOL_PREFIX)) {
            collectAgentDependency(repository, builder, toolName.substring(ActionDockDynamicAiToolProvider.AGENT_TOOL_PREFIX.length()), false);
        }
    }

    void collectScriptDependency(RepositoryDefinition repository,
                                 AiPackageBundleBuilder builder,
                                 String scriptId) {
        if (NormalizeUtils.isBlank(scriptId) || builder.hasScript(scriptId) || builder.isExternalScript(scriptId)) {
            return;
        }

        ScriptDefinition script = collectDependency(scriptId, "脚本",
                () -> scriptRepository.findById(scriptId)
                        .orElseThrow(() -> new IllegalArgumentException("脚本不存在: " + scriptId)));

        if (tryAddExternalToolDependency(builder, script)) {
            return;
        }
        ScriptDefinition published = scriptApplicationService.getPublished(scriptId);
        builder.addScript(published.getId(), toAiPackageScriptFile(published));
        collectTransitiveDependencies(repository, builder, published);
    }

    /**
     * 通用依赖收集模板方法，统一处理内部资产校验逻辑。
     * <p>
     * 当资源 ID 以内部前缀开头时，抛出异常阻止将已安装的内部资产作为发布依赖。
     *
     * @param id       资源唯一标识
     * @param kind     资源类型名称（用于异常提示信息）
     * @param resolver 资源查找函数，找不到时由调用方自行抛出异常
     * @param <T>      资源类型
     * @return 解析得到的资源实例
     * @throws IllegalArgumentException 当资源 ID 为内部资产时
     */
    private <T> T collectDependency(String id, String kind, Supplier<T> resolver) {
        if (id.startsWith(RepositoryCatalogTypes.AI_PACKAGE_INTERNAL_PREFIX)) {
            throw new IllegalArgumentException("不能将已安装 AI 能力包的内部" + kind + "作为发布依赖: " + id);
        }
        return resolver.get();
    }

    private boolean tryAddExternalToolDependency(AiPackageBundleBuilder builder, ScriptDefinition script) {
        if (script.getScope() != ScriptScope.REPOSITORY && NormalizeUtils.isBlank(script.getRepositoryId())) {
            return false;
        }
        String sourceRepositoryId = NormalizeUtils.normalizeNullable(script.getRepositoryId());
        String sourceToolId = NormalizeUtils.normalizeNullable(script.getRepositoryScriptId());
        String sourceVersion = NormalizeUtils.normalizeNullable(script.getRepositoryVersion());
        if (sourceRepositoryId != null && sourceToolId != null && sourceVersion != null) {
            builder.addExternalDependency(new RepositoryAiPackageDependency(
                    DependencyAssetType.TOOL.name(),
                    sourceRepositoryId,
                    sourceToolId,
                    sourceVersion
            ));
            return true;
        }
        return false;
    }

    private void collectTransitiveDependencies(RepositoryDefinition repository,
                                               AiPackageBundleBuilder builder,
                                               ScriptDefinition published) {
        String source = published.getSource();
        collectPluginDependencies(builder, published.getPluginDependencies());
        for (String nestedScriptId : AiPackageIdRewriter.extractScriptDependenciesFromSource(source)) {
            collectScriptDependency(repository, builder, nestedScriptId);
        }
        collectAiDependencies(repository, builder, published.getAiDependencies());
    }

    private void collectPluginDependencies(AiPackageBundleBuilder builder, List<PluginDependency> dependencies) {
        for (PluginDependency dependency : NormalizeUtils.nullSafeList(dependencies)) {
            collectPluginDependency(builder, dependency);
        }
    }

    private void collectAiDependencies(RepositoryDefinition repository,
                                       AiPackageBundleBuilder builder,
                                       List<AiDependency> dependencies) {
        for (AiDependency dependency : dependencies) {
            if (NormalizeUtils.isNotBlank(dependency.getProfile())) {
                collectModelDependency(builder, dependency.getProfile());
            }
            if (NormalizeUtils.isNotBlank(dependency.getAgentProfile())) {
                collectAgentDependency(repository, builder, dependency.getAgentProfile(), false);
            }
        }
    }

    void collectPluginDependency(AiPackageBundleBuilder builder, PluginDependency dependency) {
        if (dependency == null || NormalizeUtils.isBlank(dependency.getPluginId())) {
            return;
        }
        PluginRegistration registration = resolvePluginRegistration(dependency.getPluginId());
        builder.addExternalDependency(buildPluginDependency(registration, dependency));
    }

    private PluginRegistration resolvePluginRegistration(String pluginId) {
        try {
            return pluginRuntimeService.getRegistration(pluginId);
        } catch (IllegalArgumentException exception) {
            log.log(System.Logger.Level.WARNING, "插件注册信息查询失败: {0}", exception.getMessage());
            return null;
        }
    }

    private static RepositoryAiPackageDependency buildPluginDependency(PluginRegistration registration, PluginDependency dependency) {
        String repositoryId = registration == null ? null : NormalizeUtils.normalizeNullable(registration.getRepositoryId());
        String assetId = registration == null
                ? dependency.getPluginId()
                : NormalizeUtils.normalizeOrDefault(registration.getRepositoryPluginId(), dependency.getPluginId());
        String version = resolvePluginVersion(registration, dependency);
        return new RepositoryAiPackageDependency(
                DependencyAssetType.PLUGIN.name(),
                repositoryId == null ? "" : repositoryId,
                assetId,
                version == null ? "" : version
        );
    }

    private static String resolvePluginVersion(PluginRegistration registration, PluginDependency dependency) {
        String version = NormalizeUtils.normalizeNullable(registration == null ? null : registration.getRepositoryVersion());
        if (version == null) {
            version = NormalizeUtils.normalizeNullable(dependency.getVersionRange());
        }
        if (version == null && registration != null) {
            version = NormalizeUtils.normalizeNullable(registration.getVersion());
        }
        return version;
    }

    static AiPackageModelFile toAiPackageModelFile(AiModelProfile profile) {
        return new AiPackageModelFile(
                profile.getId(),
                profile.getName(),
                profile.getProvider() == null ? null : profile.getProvider().name(),
                profile.getModelProvider() == null ? null : profile.getModelProvider().name(),
                profile.getModelName(),
                profile.getBaseUrl(),
                profile.getApiKeyConfigKey(),
                profile.getDefaultOptions(),
                profile.getLimits(),
                profile.getCapabilities().stream().map(AiCapability::name).sorted().toList(),
                profile.isEnabled()
        );
    }

    static AiPackageToolsetFile toAiPackageToolsetFile(AiToolset toolset) {
        return new AiPackageToolsetFile(
                toolset.getId(),
                toolset.getName(),
                toolset.getDescription(),
                toolset.getToolNames(),
                toolset.getToolOptions(),
                toolset.getMaxPermission() == null ? null : toolset.getMaxPermission().name(),
                toolset.isEnabled()
        );
    }

    static AiPackageAgentFile toAiPackageAgentFile(AiAgentProfile profile) {
        return new AiPackageAgentFile(
                profile.getId(),
                profile.getName(),
                profile.getDescription(),
                profile.getProvider() == null ? null : profile.getProvider().name(),
                profile.getModelProfileId(),
                profile.getSystemPrompt(),
                profile.getToolsetIds(),
                profile.getDirectToolNames(),
                profile.getDirectToolOptions(),
                profile.getSkillIds(),
                profile.getOptions(),
                profile.isEnabled()
        );
    }

    static AiPackageScriptFile toAiPackageScriptFile(ScriptDefinition published) {
        return new AiPackageScriptFile(
                published.getId(),
                published.getName(),
                published.getType().name(),
                published.getPackaging().name(),
                published.getDescription(),
                published.getTags(),
                published.getSource(),
                published.getPythonRequirements(),
                published.getInputSchema(),
                published.getOutputSchema(),
                published.getPluginDependencies(),
                published.getAiDependencies()
        );
    }

    static boolean isAgentDependency(AiDependency dependency) {
        if (dependency == null) {
            return false;
        }
        return (NormalizeUtils.isNotBlank(dependency.getAgentProfile()))
                || "AGENT_RUN".equalsIgnoreCase(dependency.getCapability());
    }
}
