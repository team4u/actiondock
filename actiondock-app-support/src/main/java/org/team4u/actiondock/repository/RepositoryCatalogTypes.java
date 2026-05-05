package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.exception.RepositoryPluginConflict;
import org.team4u.actiondock.domain.model.AiDependency;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.plugin.PluginView;
import org.team4u.actiondock.skill.SkillFileUtils;
import org.team4u.actiondock.skill.SkillTypes;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * 仓库目录相关的数据类型定义。
 *
 * @author jay.wu
 */
public final class RepositoryCatalogTypes {

    /** 仓库索引文件名。 */
    public static final String REPOSITORY_INDEX_FILE = "actiondock.repository.json";
    /** Tool 子目录名称。 */
    public static final String TOOLS_DIR = "tools";
    /** Plugin 子目录名称。 */
    public static final String PLUGINS_DIR = "plugins";
    /** Skill 子目录名称。 */
    public static final String SKILLS_DIR = "skills";
    /** Skill 清单文件名。 */
    public static final String SKILL_MANIFEST_FILE = "skill.json";
    /** AI 能力包入口 Agent ID 前缀。 */
    public static final String AI_PACKAGE_ENTRY_PREFIX = ScriptPackaging.MANAGED_ENTRY_PREFIX;
    /** AI 能力包内部资源 ID 前缀。 */
    public static final String AI_PACKAGE_INTERNAL_PREFIX = ScriptPackaging.MANAGED_INTERNAL_PREFIX;
    /** 能力包子目录名称。 */
    public static final String CAPABILITY_PACKAGES_DIR = "packages";
    /** 仓库索引中的所有分节名称。 */
    public static final List<String> REPO_INDEX_SECTIONS = List.of(TOOLS_DIR, PLUGINS_DIR, CAPABILITY_PACKAGES_DIR, SKILLS_DIR);
    /** 默认的仓库索引/文件 schema 版本号。 */
    public static final int DEFAULT_VERSION = 1;

    /** 仓库类型：Git 仓库。 */
    public static final String REPO_TYPE_GIT = "GIT";
    /** 仓库类型：HTTP 仓库。 */
    public static final String REPO_TYPE_HTTP = "HTTP";
    /** 仓库类型：本地目录仓库。 */
    public static final String REPO_TYPE_LOCAL_DIR = "LOCAL_DIR";
    /** Git 仓库默认分支。 */
    public static final String DEFAULT_GIT_BRANCH = "main";

    public static final String ERR_HTTP_REPO_UNSUPPORTED_EXPORT = "HTTP 仓库暂不支持导出 Skill 归档";
    public static final String ERR_HTTP_REPO_UNSUPPORTED_PUBLISH = "HTTP 仓库暂不支持发布";
    /** 本地插件制品 URI scheme。 */
    public static final String LOCAL_ARTIFACT_SCHEME = "local";
    /** Windows 绝对路径正则。 */
    public static final String WINDOWS_ABSOLUTE_PATH_REGEX = "^[A-Za-z]:[\\\\/].*";

    /** 仓库用途：开发仓库。 */
    public static final String REPO_USAGE_DEVELOPMENT = "DEVELOPMENT";
    /** 仓库用途：分发仓库。 */
    public static final String REPO_USAGE_DISTRIBUTION = "DISTRIBUTION";

    /** 仓库信任级别：受信任。 */
    public static final String REPO_TRUST_TRUSTED = "TRUSTED";
    /** 仓库信任级别：不受信任。 */
    public static final String REPO_TRUST_UNTRUSTED = "UNTRUSTED";

    /** 能力包检查严重级别：阻断。 */
    public static final String CHECK_SEVERITY_BLOCKER = "BLOCKER";
    /** 能力包检查严重级别：警告。 */
    public static final String CHECK_SEVERITY_WARNING = "WARNING";
    /** 能力包检查严重级别：信息。 */
    public static final String CHECK_SEVERITY_INFO = "INFO";
    /** 能力包入口类型：Agent。 */
    public static final String ENTRY_TYPE_AGENT = "AGENT";
    /** 能力包入口类型：脚本。 */
    public static final String ENTRY_TYPE_SCRIPT = "SCRIPT";
    /** 资产类型：工具。 */
    public static final String ASSET_TYPE_TOOL = "TOOL";
    /** 资产类型：插件。 */
    public static final String ASSET_TYPE_PLUGIN = "PLUGIN";
    /** 资产类型：能力包。 */
    public static final String ASSET_TYPE_CAPABILITY_PACKAGE = "CAPABILITY_PACKAGE";
    /** 资产类型：技能。 */
    public static final String ASSET_TYPE_SKILL = "SKILL";

    /** 配置发布模式：内联（值直接嵌入脚本源码）。 */
    public static final String PUBLISH_MODE_INLINE = "INLINE";
    /** 配置发布模式：占位符（值在运行时注入）。 */
    public static final String PUBLISH_MODE_PLACEHOLDER = "PLACEHOLDER";

    public record ToolInstallationOptions(
            boolean installSchedules,
            boolean installScriptDependencies,
            boolean installPluginDependencies,
            boolean forcePluginUpgrade
    ) {
        public static final ToolInstallationOptions DEFAULT = new ToolInstallationOptions(false, false, false, false);
    }

    private RepositoryCatalogTypes() {
    }

    /**
     * 从能力包入口列表中解析运行时入口 ID。
     * <p>
     * 遍历入口文件列表，找到第一个类型为 AGENT 或 SCRIPT 的入口，
     * 使用对应的 ID 映射表将本地 ID 转换为运行时 ID。
     *
     * @param entries          能力包入口文件列表，可以为 null
     * @param agentIdMappings  Agent 本地 ID 到运行时 ID 的映射
     * @param scriptIdMappings 脚本本地 ID 到运行时 ID 的映射
     * @return 第一个匹配入口的运行时 ID，如果没有匹配则返回 null
     */
    public static String resolveRuntimeEntry(List<CapabilityPackageEntryFile> entries,
                                             Map<String, String> agentIdMappings,
                                             Map<String, String> scriptIdMappings) {
        for (CapabilityPackageEntryFile entry : nullSafeList(entries)) {
            if (ENTRY_TYPE_AGENT.equalsIgnoreCase(entry.type())) {
                return agentIdMappings.getOrDefault(entry.id(), entry.id());
            }
            if (ENTRY_TYPE_SCRIPT.equalsIgnoreCase(entry.type())) {
                return scriptIdMappings.getOrDefault(entry.id(), entry.id());
            }
        }
        return null;
    }

    /**
     * 创建一个新的仓库索引文件，替换其中的工具列表，保留其他条目不变。
     */
    public static RepositoryIndexFile withTools(RepositoryIndexFile current,
                                                 RepositoryDefinition repository,
                                                 List<RepositoryIndexEntry> tools) {
        return withReplaced(current, repository, tools, null, null, null);
    }

    /**
     * 创建一个新的仓库索引文件，替换其中的插件列表，保留其他条目不变。
     */
    public static RepositoryIndexFile withPlugins(RepositoryIndexFile current,
                                                   RepositoryDefinition repository,
                                                   List<RepositoryPluginIndexEntry> plugins) {
        return withReplaced(current, repository, null, plugins, null, null);
    }

    /**
     * 创建一个新的仓库索引文件，替换其中的能力包列表，保留其他条目不变。
     */
    public static RepositoryIndexFile withPackages(RepositoryIndexFile current,
                                                    RepositoryDefinition repository,
                                                    List<CapabilityPackageIndexEntry> packages) {
        return withReplaced(current, repository, null, null, packages, null);
    }

    /**
     * 创建一个新的仓库索引文件，替换其中的 Skill 列表，保留其他条目不变。
     */
    public static RepositoryIndexFile withSkills(RepositoryIndexFile current,
                                                  RepositoryDefinition repository,
                                                  List<RepositorySkillIndexEntry> skills) {
        return withReplaced(current, repository, null, null, null, skills);
    }

    @SuppressWarnings("unchecked")
    private static <T extends Record> RepositoryIndexFile withReplaced(RepositoryIndexFile current,
                                                                        RepositoryDefinition repository,
                                                                        List<RepositoryIndexEntry> tools,
                                                                        List<RepositoryPluginIndexEntry> plugins,
                                                                        List<CapabilityPackageIndexEntry> packages,
                                                                        List<RepositorySkillIndexEntry> skills) {
        return new RepositoryIndexFile(
                DEFAULT_VERSION,
                repository.getName(),
                normalizeNullable(repository.getDescription()),
                tools != null ? tools : new ArrayList<>(nullSafeList(current == null ? null : current.tools())),
                plugins != null ? plugins : new ArrayList<>(nullSafeList(current == null ? null : current.plugins())),
                packages != null ? packages : new ArrayList<>(nullSafeList(current == null ? null : current.packages())),
                skills != null ? skills : new ArrayList<>(nullSafeList(current == null ? null : current.skills()))
        );
    }

    static <T> List<T> nullSafeList(List<T> list) {
        return SkillFileUtils.nullSafeList(list);
    }

    static <T> List<T> upsertSorted(List<T> entries, T newEntry, Function<T, String> idExtractor) {
        List<T> updated = new ArrayList<>(entries);
        updated.removeIf(item -> idExtractor.apply(item).equals(idExtractor.apply(newEntry)));
        updated.add(newEntry);
        updated.sort(Comparator.comparing(idExtractor));
        return updated;
    }

    static String normalizeNullable(String value) {
        return SkillFileUtils.normalizeNullable(value);
    }

    public record RepositoryToolDescriptor(
            String repositoryId,
            String toolId,
            String installedScriptId,
            String displayName,
            String version,
            String description,
            String releaseNotes,
            String owner,
            List<String> tags,
            String type,
            String packaging,
            String sourcePath,
            String pythonRequirementsPath,
            String inputSchemaPath,
            String outputSchemaPath,
            String configTemplatePath,
            String scheduleTemplatePath,
            String digest,
            String riskLevel,
            List<ScriptDependency> scriptDependencies,
            List<PluginDependency> pluginDependencies,
            boolean installed,
            String installedVersion,
            boolean updateAvailable,
            boolean trusted,
            String repositoryUsage,
            String developmentScriptId,
            boolean developmentDirty,
            boolean developmentRemoteChanged,
            String developmentSyncState
    ) {
        public RepositoryToolDescriptor withDevelopment(String devScriptId,
                                                         boolean dirty,
                                                         boolean remoteChanged,
                                                         String syncState) {
            return new RepositoryToolDescriptor(
                    repositoryId, toolId, installedScriptId, displayName, version,
                    description, releaseNotes, owner, tags, type, packaging,
                    sourcePath, pythonRequirementsPath, inputSchemaPath, outputSchemaPath,
                    configTemplatePath, scheduleTemplatePath, digest, riskLevel,
                    scriptDependencies, pluginDependencies, installed, installedVersion,
                    updateAvailable, trusted, repositoryUsage,
                    devScriptId, dirty, remoteChanged, syncState
            );
        }
    }

    public record RepositoryToolDetail(
            RepositoryToolDescriptor descriptor,
            String source,
            String pythonRequirements,
            List<ConfigTemplateItem> configTemplate,
            List<ScheduleTemplateItem> scheduleTemplate
    ) {
    }

    public record RepositoryPublishRequest(
            String scriptId,
            String toolId,
            String displayName,
            String version,
            String owner,
            String releaseNotes,
            List<String> tags,
            List<String> scheduleIds,
            List<RepositoryPublishConfigItem> configItems,
            List<ScriptDependency> scriptDependencies,
            boolean force
    ) {
    }

    public record RepositoryPublishConfigPreviewRequest(
            String scriptId,
            String source,
            List<String> scheduleIds
    ) {
    }

    public record RepositoryPublishConfigPreview(
            List<RepositoryPublishConfigCandidate> items,
            List<String> missingKeys
    ) {
    }

    public record RepositoryPublishConfigCandidate(
            String key,
            String label,
            boolean secret
    ) {
    }

    public record RepositoryAiPackageDependency(
            String assetType,
            String repositoryId,
            String assetId,
            String version
    ) {
    }

    public record CapabilityPackageDescriptor(
            String repositoryId,
            String packageId,
            String installationId,
            String displayName,
            String version,
            String description,
            String releaseNotes,
            String owner,
            List<String> tags,
            String riskLevel,
            List<CapabilityPackageEntryFile> entries,
            String manifestPath,
            String releasePath,
            boolean installed,
            String installedVersion,
            boolean updateAvailable,
            boolean trusted,
            String repositoryUsage
    ) {
    }

    public record CapabilityPackageDetail(
            CapabilityPackageDescriptor descriptor,
            List<ConfigTemplateItem> configTemplate,
            List<ScheduleTemplateItem> scheduleTemplate,
            List<CapabilityPackagePresetTemplate> presetTemplate,
            CapabilityPackageReleaseFile releaseFile
    ) {
    }

    public record CapabilityPackagePublishRequest(
            String packageId,
            String displayName,
            String version,
            String owner,
            String description,
            String releaseNotes,
            List<String> tags,
            String riskLevel,
            CapabilityPackageSource source,
            CapabilityPackageEntrySelection primaryEntry,
            List<String> scriptIds,
            List<String> agentIds,
            List<String> modelIds,
            List<String> toolsetIds
    ) {
    }

    public record CapabilityPackagePublishPreview(
            String packageId,
            String version,
            List<CapabilityPackageEntryFile> entries,
            List<String> modelIds,
            List<String> toolsetIds,
            List<String> agentIds,
            List<String> scriptIds,
            List<ConfigTemplateItem> configTemplate,
            List<ScheduleTemplateItem> scheduleTemplate,
            List<CapabilityPackagePresetTemplate> presetTemplate,
            List<RepositoryAiPackageDependency> externalDependencies,
            List<CapabilityPackageCheck> checks,
            CapabilityPackageDiffSummary diff
    ) {
    }

    public record CapabilityPackageInstallResult(
            org.team4u.actiondock.domain.model.CapabilityPackageInstallation installation,
            List<RepositoryAiPackageDependency> resolvedDependencies
    ) {
    }

    public record CapabilityPackageEntrySelection(
            String type,
            String targetId,
            String displayName
    ) {
    }

    public record CapabilityPackagePresetTemplate(
            String id,
            String scriptId,
            String name,
            Map<String, Object> input
    ) {
    }

    public record CapabilityPackageCheck(
            String severity,
            String code,
            String message
    ) {
    }

    public record CapabilityPackageDiffSummary(
            String comparisonMode,
            List<String> addedEntries,
            List<String> removedEntries,
            List<String> changedAssets
    ) {
    }

    public enum CapabilityPackageSource {
        AGENT,
        SCRIPT,
        MANUAL
    }

    public enum DevelopmentSyncState {
        SYNCED,
        LOCAL_CHANGES,
        REMOTE_CHANGES,
        DIVERGED
    }

    public enum DependencyAssetType {
        AI_PACKAGE,
        TOOL,
        PLUGIN;

        public static DependencyAssetType fromString(String value) {
            if (value == null) {
                throw new IllegalArgumentException("不支持的能力包依赖类型: null");
            }
            for (DependencyAssetType type : values()) {
                if (type.name().equalsIgnoreCase(value)) {
                    return type;
                }
            }
            throw new IllegalArgumentException("不支持的能力包依赖类型: " + value);
        }
    }

    public record DevelopmentSyncRequest(String scriptId) {
    }

    public record DevelopmentStatus(String scriptId,
                                    String repositoryId,
                                    String repositoryToolId,
                                    String repositoryVersion,
                                    String localCommit,
                                    String remoteCommit,
                                    String baseDigest,
                                    String localDigest,
                                    String remoteDigest,
                                    boolean dirty,
                                    boolean remoteChanged,
                                    String syncState,
                                    String remoteVersion,
                                    LocalDateTime sourceSyncedAt) {
    }

    public record RepositoryPluginDescriptor(
            String repositoryId,
            String pluginId,
            String displayName,
            String version,
            String description,
            String releaseNotes,
            String owner,
            List<String> tags,
            PluginArtifactRef artifact,
            String riskLevel,
            boolean installed,
            String installedVersion,
            boolean updateAvailable,
            boolean trusted,
            int dependentToolCount
    ) {
    }

    public record RepositoryPluginDetail(
            RepositoryPluginDescriptor descriptor,
            PluginFile plugin
    ) {
    }

    public record RepositorySkillDescriptor(
            String repositoryId,
            String skillId,
            String displayName,
            String version,
            String description,
            String releaseNotes,
            String owner,
            List<String> tags,
            String manifestPath,
            String entrypointPath,
            String digest,
            String riskLevel,
            boolean trusted,
            String repositoryUsage
    ) {
    }

    public record RepositorySkillDetail(
            RepositorySkillDescriptor descriptor,
            String content
    ) {
    }

    public record RepositoryBinaryArchive(
            String fileName,
            byte[] content
    ) {
    }

    public record RepositoryPluginPublishRequest(
            String pluginId,
            String displayName,
            String version,
            String owner,
            String description,
            String releaseNotes,
            List<String> tags,
            String riskLevel,
            PluginArtifactRef artifact
    ) {
    }

    public record RepositoryPluginInstallResult(
            PluginView plugin,
            List<RepositoryPluginConflict> conflicts
    ) {
    }

    public record RepositoryPublishConfigItem(String key, String publishMode) {
    }

    public record RepositoryIndexFile(int repositoryVersion,
                                      String name,
                                      String description,
                                      List<RepositoryIndexEntry> tools,
                                      List<RepositoryPluginIndexEntry> plugins,
                                      List<CapabilityPackageIndexEntry> packages,
                                      List<RepositorySkillIndexEntry> skills) {
        public RepositoryIndexFile(int repositoryVersion,
                                   String name,
                                   String description,
                                   List<RepositoryIndexEntry> tools,
                                   List<RepositoryPluginIndexEntry> plugins,
                                   List<CapabilityPackageIndexEntry> packages) {
            this(repositoryVersion, name, description, tools, plugins, packages, List.of());
        }
    }

    public record RepositoryIndexEntry(String id,
                                       String name,
                                       String version,
                                       String type,
                                       String description,
                                       String releaseNotes,
                                       String toolPath) {
    }

    public record RepositoryPluginIndexEntry(String id,
                                             String name,
                                             String version,
                                             String description,
                                             String releaseNotes,
                                             String pluginPath) {
    }

    public record CapabilityPackageIndexEntry(String id,
                                              String name,
                                              String version,
                                              String description,
                                              String releaseNotes,
                                              String path) {
    }

    public record RepositorySkillIndexEntry(String id,
                                            String name,
                                            String version,
                                            String description,
                                            String releaseNotes,
                                            String skillPath) {
        public static RepositorySkillIndexEntry fromSkillValidation(SkillTypes.SkillValidationResult validation,
                                                                     String version,
                                                                     String releaseNotes) {
            return new RepositorySkillIndexEntry(
                    validation.skillId(),
                    SkillFileUtils.normalize(validation.displayName(), "displayName 不能为空"),
                    SkillFileUtils.normalize(version, SkillFileUtils.ERR_VERSION_REQUIRED),
                    SkillFileUtils.normalizeNullable(validation.description()),
                    SkillFileUtils.normalizeNullable(releaseNotes),
                    SKILLS_DIR + "/" + validation.skillId() + "/" + SKILL_MANIFEST_FILE
            );
        }
    }

    public record CapabilityPackageManifestFile(int schemaVersion,
                                                String packageId,
                                                String displayName,
                                                String latestVersion,
                                                String description,
                                                String releaseNotes,
                                                String owner,
                                                List<String> tags,
                                                String riskLevel,
                                                List<CapabilityPackageEntryFile> entries,
                                                String latestReleasePath) {
    }

    public record SkillFile(int schemaVersion,
                            String skillId,
                            String displayName,
                            String version,
                            String description,
                            String owner,
                            List<String> tags,
                            String riskLevel,
                            String entrypointPath,
                            String digest) {
    }

    public record CapabilityPackageReleaseFile(int schemaVersion,
                                               String packageId,
                                               String displayName,
                                               String version,
                                               String description,
                                               String releaseNotes,
                                               String owner,
                                               List<String> tags,
                                               String riskLevel,
                                               String sourceType,
                                               List<CapabilityPackageEntryFile> entries,
                                               List<AiPackageModelFile> models,
                                               List<AiPackageToolsetFile> toolsets,
                                               List<AiPackageAgentFile> agents,
                                               List<AiPackageScriptFile> scripts,
                                               List<RepositoryAiPackageDependency> externalDependencies,
                                               String configTemplatePath,
                                               String scheduleTemplatePath,
                                               String presetTemplatePath) {
    }

    public record CapabilityPackageEntryFile(String type,
                                             String id,
                                             String displayName,
                                             String target) {
    }

    record CapabilityPackageDraft(String packageId,
                                          String displayName,
                                          String version,
                                          String owner,
                                          String description,
                                          String releaseNotes,
                                          List<String> tags,
                                          String riskLevel,
                                          CapabilityPackageSource source,
                                          List<CapabilityPackageEntryFile> entries,
                                          AiPackageBundle bundle,
                                          List<ConfigTemplateItem> configTemplate,
                                          List<ScheduleTemplateItem> scheduleTemplate,
                                          List<CapabilityPackagePresetTemplate> presetTemplate) {
    }

    public record ToolFile(int toolVersion,
                           String id,
                           String name,
                           String version,
                           String type,
                           String packaging,
                           String description,
                           String releaseNotes,
                           String owner,
                           List<String> tags,
                           String sourcePath,
                           String pythonRequirementsPath,
                           String inputSchemaPath,
                           String outputSchemaPath,
                           String configTemplatePath,
                           String scheduleTemplatePath,
                           String digest,
                           String riskLevel,
                           List<ScriptDependency> scriptDependencies,
                           List<PluginDependency> pluginDependencies) {
    }

    public record PluginFile(int pluginFileVersion,
                             String pluginId,
                             String name,
                             String version,
                             String description,
                             String releaseNotes,
                             String owner,
                             List<String> tags,
                             PluginArtifactRef artifact,
                             String riskLevel) {
    }

    public record AiPackageModelFile(String id,
                                     String name,
                                     String provider,
                                     String modelProvider,
                                     String modelName,
                                     String baseUrl,
                                     String apiKeyConfigKey,
                                     Map<String, Object> defaultOptions,
                                     Map<String, Object> limits,
                                     List<String> capabilities,
                                     boolean enabled) {
        public AiPackageModelFile withId(String newId) {
            return new AiPackageModelFile(newId, name, provider, modelProvider, modelName,
                    baseUrl, apiKeyConfigKey, defaultOptions, limits, capabilities, enabled);
        }
    }

    public record AiPackageToolsetFile(String id,
                                       String name,
                                       String description,
                                       List<String> toolNames,
                                       Map<String, Map<String, Object>> toolOptions,
                                       String maxPermission,
                                       boolean enabled) {
        public AiPackageToolsetFile withId(String newId) {
            return new AiPackageToolsetFile(newId, name, description, toolNames,
                    toolOptions, maxPermission, enabled);
        }
    }

    public record AiPackageAgentFile(String id,
                                     String name,
                                     String description,
                                     String provider,
                                     String modelProfileId,
                                     String systemPrompt,
                                     List<String> toolsetIds,
                                     List<String> directToolNames,
                                     Map<String, Map<String, Object>> directToolOptions,
                                     List<String> skillIds,
                                     Map<String, Object> options,
                                     boolean enabled) {
        public AiPackageAgentFile withId(String newId) {
            return new AiPackageAgentFile(newId, name, description, provider, modelProfileId,
                    systemPrompt, toolsetIds, directToolNames, directToolOptions,
                    skillIds, options, enabled);
        }
    }

    public record AiPackageScriptFile(String id,
                                      String name,
                                      String type,
                                      String packaging,
                                      String description,
                                      List<String> tags,
                                      String source,
                                      String pythonRequirements,
                                      Map<String, Object> inputSchema,
                                      Map<String, Object> outputSchema,
                                      List<PluginDependency> pluginDependencies,
                                      List<AiDependency> aiDependencies) {
        public AiPackageScriptFile withId(String newId) {
            return new AiPackageScriptFile(newId, name, type, packaging, description,
                    tags, source, pythonRequirements, inputSchema, outputSchema,
                    pluginDependencies, aiDependencies);
        }
    }

    public record ConfigTemplateItem(String key,
                                     String label,
                                     String type,
                                     boolean required,
                                     boolean secret,
                                     String defaultValue) {
        public String resolvePublishMode() {
            return (secret || defaultValue == null || defaultValue.isBlank())
                    ? PUBLISH_MODE_PLACEHOLDER
                    : PUBLISH_MODE_INLINE;
        }
    }

    public record ScheduleTemplateItem(String id,
                                       String scriptId,
                                       String name,
                                       String cronExpression,
                                       Map<String, Object> input,
                                       boolean enabledByDefault) {
    }

    record AiPackageBundle(String repositoryId,
                           String packageId,
                           String entryAgentId,
                           String entryAgentName,
                           String entryAgentDescription,
                           Map<String, AiPackageModelFile> models,
                           Map<String, AiPackageToolsetFile> toolsets,
                           Map<String, AiPackageAgentFile> agents,
                           Map<String, AiPackageScriptFile> scripts,
                           Map<String, RepositoryAiPackageDependency> externalDependencies) {
    }

    record ToolSourceState(String path, String commit, String digest) {
    }
}
