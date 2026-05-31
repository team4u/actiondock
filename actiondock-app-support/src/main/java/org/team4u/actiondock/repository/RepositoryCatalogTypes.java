package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.exception.RepositoryVersionExistsException;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.domain.exception.RepositoryPluginConflict;
import org.team4u.actiondock.domain.model.AiDependency;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookAgentSkillRef;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRef;
import org.team4u.actiondock.domain.model.PlaybookRelatedRef;
import org.team4u.actiondock.domain.model.PlaybookScriptRef;
import org.team4u.actiondock.domain.model.WebhookTransport;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.WebhookSampleRequest;
import org.team4u.actiondock.plugin.PluginView;
import org.team4u.actiondock.skill.SkillArchiveManager;
import org.team4u.actiondock.skill.SkillFileUtils;
import org.team4u.actiondock.skill.SkillTypes;
import org.team4u.actiondock.common.NormalizeUtils;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.nio.file.Path;
import java.util.function.Function;

/**
 * 仓库目录相关的数据类型定义。
 *
 * @author jay.wu
 */
public final class RepositoryCatalogTypes {

    /** Script 子目录名称。 */
    public static final String SCRIPTS_DIR = "scripts";
    /** Event Source 子目录名称。 */
    public static final String WEBHOOKS_DIR = "webhooks";
    /** Script 描述文件名。 */
    public static final String SCRIPT_DESCRIPTOR_FILE = "script.json";
    /** Event Source 描述文件名。 */
    public static final String WEBHOOK_DESCRIPTOR_FILE = "webhook.json";
    /** Plugin 子目录名称。 */
    public static final String PLUGINS_DIR = "plugins";
    /** Plugin 索引文件名。 */
    public static final String PLUGIN_INDEX_FILE = "plugin.json";
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
    /** Knowledge 子目录名称。 */
    public static final String KNOWLEDGE_DIR = "knowledge";
    /** Knowledge 清单文件名。 */
    public static final String KNOWLEDGE_MANIFEST_FILE = "knowledge.json";
    /** Knowledge 配置模板文件名。 */
    public static final String KNOWLEDGE_CONFIG_TEMPLATE_FILE = "config.template.json";
    /** Playbook 子目录名称。 */
    public static final String PLAYBOOKS_DIR = "playbooks";
    /** Playbook 描述文件名。 */
    public static final String PLAYBOOK_DESCRIPTOR_FILE = "playbook.json";
    /** 仓库索引中的所有分节名称。 */
    public static final List<String> REPO_INDEX_SECTIONS = List.of(SCRIPTS_DIR, WEBHOOKS_DIR, PLUGINS_DIR, CAPABILITY_PACKAGES_DIR, SKILLS_DIR, KNOWLEDGE_DIR, PLAYBOOKS_DIR);
    /** 默认的仓库索引/文件 schema 版本号。由 {@link RepositoryIndexUtils} 维护。 */

    /** 仓库类型：Git 仓库。 */
    public static final String REPO_TYPE_GIT = "GIT";
    /** 仓库类型：HTTP 仓库。 */
    public static final String REPO_TYPE_HTTP = "HTTP";
    /** 仓库类型：本地目录仓库。 */
    public static final String REPO_TYPE_LOCAL_DIR = "LOCAL_DIR";
    /** Git 仓库默认分支。 */
    public static final String DEFAULT_GIT_BRANCH = "main";
    /** 仓库用途：能力仓库。 */
    public static final String REPO_PURPOSE_CAPABILITY = "CAPABILITY";
    /** 仓库用途：项目仓库。 */
    public static final String REPO_PURPOSE_PROJECT = "PROJECT";
    /** 项目知识入口默认文件。 */
    public static final String DEFAULT_PROJECT_ENTRY_PATH = "ACTIONDOCK.md";

    public static final String ERR_HTTP_REPO_UNSUPPORTED_EXPORT = "HTTP 仓库暂不支持导出 Skill 归档";
    public static final String ERR_HTTP_REPO_UNSUPPORTED_PUBLISH = "HTTP 仓库暂不支持发布";
    /** 本地插件制品 URI scheme。 */
    public static final String LOCAL_ARTIFACT_SCHEME = "local";
    /** Windows 绝对路径正则。 */
    public static final String WINDOWS_ABSOLUTE_PATH_REGEX = "^[A-Za-z]:[\\\\/].*";

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
    /** 资产类型：Webhook。 */
    public static final String ASSET_TYPE_WEBHOOK = "WEBHOOK";
    /** 资产类型：插件。 */
    public static final String ASSET_TYPE_PLUGIN = "PLUGIN";
    /** 资产类型：能力包。 */
    public static final String ASSET_TYPE_CAPABILITY_PACKAGE = "CAPABILITY_PACKAGE";
    /** 资产类型：技能。 */
    public static final String ASSET_TYPE_SKILL = "SKILL";
    /** 资产类型：知识源。 */
    public static final String ASSET_TYPE_KNOWLEDGE = "KNOWLEDGE";
    /** 资产类型：任务手册。 */
    public static final String ASSET_TYPE_PLAYBOOK = "PLAYBOOK";

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

    public record RepositoryLocalAssetRequest(
            String mode,
            String localAssetId,
            boolean installSchedules,
            boolean installScriptDependencies,
            boolean installPluginDependencies,
            boolean forcePluginUpgrade
    ) {
        public ToolInstallationOptions toOptions() {
            return new ToolInstallationOptions(installSchedules, installScriptDependencies, installPluginDependencies, forcePluginUpgrade);
        }
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
    static String resolveRuntimeEntry(List<CapabilityPackageEntryFile> entries,
                                             Map<String, String> agentIdMappings,
                                             Map<String, String> scriptIdMappings) {
        for (CapabilityPackageEntryFile entry : NormalizeUtils.nullSafeList(entries)) {
            if (ENTRY_TYPE_AGENT.equalsIgnoreCase(entry.type())) {
                return agentIdMappings.getOrDefault(entry.id(), entry.id());
            }
            if (ENTRY_TYPE_SCRIPT.equalsIgnoreCase(entry.type())) {
                return scriptIdMappings.getOrDefault(entry.id(), entry.id());
            }
        }
        return null;
    }

    public record RepositoryScriptDescriptor(
            String repositoryId,
            String scriptId,
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
            boolean trusted,
            RepositoryLocalAssetState localState
    ) {
        public RepositoryScriptDescriptor withLocalState(RepositoryLocalAssetState localState) {
            return new RepositoryScriptDescriptor(
                    repositoryId, scriptId, displayName, version,
                    description, releaseNotes, owner, tags, type, packaging,
                    sourcePath, pythonRequirementsPath, inputSchemaPath, outputSchemaPath,
                    configTemplatePath, scheduleTemplatePath, digest, riskLevel,
                    scriptDependencies, pluginDependencies, trusted, localState
            );
        }
    }

    public record RepositoryLocalAssetState(
            String mode,
            String localAssetId,
            String version,
            String latestVersion,
            boolean updateAvailable,
            String syncState,
            boolean dirty,
            boolean remoteChanged
    ) {
    }

    public record RepositoryScriptDetail(
            RepositoryScriptDescriptor descriptor,
            String source,
            String pythonRequirements,
            List<ConfigTemplateItem> configTemplate,
            List<ScheduleTemplateItem> scheduleTemplate
    ) {
    }

    public record RepositoryWebhookDescriptor(
            String repositoryId,
            String webhookId,
            String displayName,
            String version,
            String description,
            String releaseNotes,
            String owner,
            List<String> tags,
            String webhookPath,
            String configTemplatePath,
            String digest,
            List<ScriptDependency> scriptDependencies,
            boolean trusted,
            RepositoryLocalAssetState localState
    ) {
        public RepositoryWebhookDescriptor withLocalState(RepositoryLocalAssetState localState) {
            return new RepositoryWebhookDescriptor(
                    repositoryId, webhookId, displayName, version,
                    description, releaseNotes, owner, tags, webhookPath, configTemplatePath,
                    digest, scriptDependencies, trusted, localState
            );
        }
    }

    public record RepositoryWebhookDetail(
            RepositoryWebhookDescriptor descriptor,
            WebhookFile webhook,
            List<ConfigTemplateItem> configTemplate
    ) {
    }

    public record RepositoryPlaybookDescriptor(
            String repositoryId,
            String playbookId,
            String displayName,
            String version,
            String description,
            String releaseNotes,
            String owner,
            List<String> tags,
            String riskLevel,
            String playbookPath,
            String digest,
            boolean trusted,
            RepositoryLocalAssetState localState
    ) {
        public RepositoryPlaybookDescriptor withLocalState(RepositoryLocalAssetState localState) {
            return new RepositoryPlaybookDescriptor(
                    repositoryId, playbookId, displayName, version,
                    description, releaseNotes, owner, tags, riskLevel,
                    playbookPath, digest, trusted, localState
            );
        }
    }

    public record RepositoryPlaybookDetail(
            RepositoryPlaybookDescriptor descriptor,
            PlaybookFile playbook
    ) {
    }

    public record RepositoryPublishRequest(
            String scriptId,
            String repositoryScriptId,
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

    public record RepositoryKnowledgePublishPreviewRequest(
            String projectRepositoryId
    ) {
    }

    public record RepositoryKnowledgePublishRequest(
            String projectRepositoryId,
            String targetRepositoryId,
            String knowledgeId,
            String displayName,
            String description,
            List<String> tags,
            List<RepositoryPublishConfigItem> configItems
    ) {
    }

    public record RepositoryWebhookPublishRequest(
            String sourceId,
            String webhookId,
            String displayName,
            String version,
            String owner,
            String releaseNotes,
            List<String> tags,
            List<RepositoryPublishConfigItem> configItems,
            List<ScriptDependency> scriptDependencies,
            boolean publishScriptDependencies,
            boolean force
    ) {
    }

    public record RepositoryPlaybookPublishRequest(
            String sourceId,
            String playbookId,
            String displayName,
            String version,
            String owner,
            String releaseNotes,
            List<String> tags,
            boolean force
    ) {
    }

    public record RepositoryWebhookPublishPreviewRequest(
            String sourceId,
            String repositoryId,
            List<ScriptDependency> scriptDependencies
    ) {
    }

    public record RepositoryWebhookPublishDependencyDraft(
            String scriptId,
            String repositoryId,
            String repositoryScriptId,
            String versionRange,
            String state
    ) {
    }

    public record RepositoryWebhookPublishPreview(
            List<RepositoryPublishConfigCandidate> items,
            List<String> missingKeys,
            List<ScriptDependency> scriptDependencies,
            List<RepositoryWebhookPublishDependencyDraft> dependencyDrafts
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
            boolean trusted
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
            List<String> toolsetIds,
            List<String> playbookIds
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
            List<String> playbookIds,
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

    public enum UpstreamSyncState {
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

    public record WorkingCopyRequest(String id) {
    }

    public record UpstreamStatus(String localAssetId,
                                 String repositoryId,
                                 String upstreamAssetId,
                                 String upstreamVersion,
                                 String localCommit,
                                 String remoteCommit,
                                 String baseDigest,
                                 String localDigest,
                                 String remoteDigest,
                                 boolean dirty,
                                 boolean remoteChanged,
                                 String syncState,
                                 String remoteVersion,
                                 LocalDateTime lastSyncedAt) {
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
            boolean installed,
            String installedVersion,
            boolean updateAvailable,
            boolean trusted
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
                                      List<RepositoryIndexEntry> scripts,
                                      List<RepositoryWebhookIndexEntry> webhooks,
                                      List<RepositoryPluginIndexEntry> plugins,
                                      List<CapabilityPackageIndexEntry> packages,
                                      List<RepositorySkillIndexEntry> skills,
                                      List<RepositoryKnowledgeIndexEntry> knowledge,
                                      List<RepositoryPlaybookIndexEntry> playbooks) {
        public RepositoryIndexFile(int repositoryVersion,
                                   String name,
                                   String description,
                                   List<RepositoryIndexEntry> scripts,
                                   List<RepositoryPluginIndexEntry> plugins,
                                   List<CapabilityPackageIndexEntry> packages) {
            this(repositoryVersion, name, description, scripts, List.of(), plugins, packages, List.of(), List.of(), List.of());
        }

        public List<RepositoryIndexEntry> safeScripts() {
            return scripts == null ? List.of() : scripts;
        }

        public List<RepositoryWebhookIndexEntry> safeWebhooks() {
            return webhooks == null ? List.of() : webhooks;
        }

        public List<RepositoryPluginIndexEntry> safePlugins() {
            return plugins == null ? List.of() : plugins;
        }

        public List<CapabilityPackageIndexEntry> safeCapabilityPackages() {
            return packages == null ? List.of() : packages;
        }

        public List<RepositorySkillIndexEntry> safeSkills() {
            return skills == null ? List.of() : skills;
        }

        public List<RepositoryKnowledgeIndexEntry> safeKnowledge() {
            return knowledge == null ? List.of() : knowledge;
        }

        public List<RepositoryPlaybookIndexEntry> safePlaybooks() {
            return playbooks == null ? List.of() : playbooks;
        }
    }

    public record RepositoryIndexEntry(String id,
                                       String name,
                                       String version,
                                       String type,
                                       String description,
                                       String releaseNotes,
                                       String scriptPath) {
    }

    public record RepositoryWebhookIndexEntry(String id,
                                                  String name,
                                                  String version,
                                                  String description,
                                                  String releaseNotes,
                                                  String webhookPath) {
    }

    public record RepositoryPlaybookIndexEntry(String id,
                                               String name,
                                               String version,
                                               String description,
                                               String releaseNotes,
                                               String playbookPath) {
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
                    NormalizeUtils.normalize(validation.displayName(), "displayName 不能为空"),
                    NormalizeUtils.normalize(version, SkillFileUtils.ERR_VERSION_REQUIRED),
                    NormalizeUtils.normalizeNullable(validation.description()),
                    NormalizeUtils.normalizeNullable(releaseNotes),
                    SKILLS_DIR + "/" + validation.skillId() + "/" + SkillArchiveManager.SKILL_PACKAGE_FILE
            );
        }
    }

    public record KnowledgeSource(
            String type,
            String url,
            String branch,
            String entryPath
    ) {
        public String safeEntryPath() {
            return NormalizeUtils.isBlank(entryPath) ? DEFAULT_PROJECT_ENTRY_PATH : entryPath;
        }
    }

    public record KnowledgeFile(
            int schemaVersion,
            String knowledgeId,
            String displayName,
            String description,
            KnowledgeSource source,
            List<String> tags,
            String configTemplatePath
    ) {
        public KnowledgeFile(int schemaVersion,
                             String knowledgeId,
                             String displayName,
                             String description,
                             KnowledgeSource source,
                             List<String> tags) {
            this(schemaVersion, knowledgeId, displayName, description, source, tags, null);
        }
    }

    public record RepositoryKnowledgeIndexEntry(
            String id,
            String name,
            String description,
            String knowledgePath,
            KnowledgeSource source,
            List<String> tags
    ) {
    }

    public record RepositoryKnowledgeDescriptor(
            String repositoryId,
            String knowledgeId,
            String displayName,
            String description,
            List<String> tags,
            String knowledgePath,
            KnowledgeSource source,
            boolean installed,
            String installedRepositoryId,
            boolean trusted
    ) {
    }

    public record RepositoryKnowledgeDetail(
            RepositoryKnowledgeDescriptor descriptor,
            KnowledgeFile knowledge,
            List<ConfigTemplateItem> configTemplate
    ) {
    }

    public record RepositoryProjectFileNode(
            String name,
            String path,
            boolean directory,
            Long size,
            boolean hasChildren
    ) {
    }

    public record RepositoryProjectFilePreview(
            String path,
            String name,
            boolean directory,
            String contentType,
            long size,
            String previewType,
            String language,
            String textContent,
            String dataUrl,
            boolean truncated
    ) {
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
                                               List<Playbook> playbooks,
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
                                          List<Playbook> playbooks,
                                          List<ConfigTemplateItem> configTemplate,
                                          List<ScheduleTemplateItem> scheduleTemplate,
                                          List<CapabilityPackagePresetTemplate> presetTemplate) {
    }

    public record ToolFile(int scriptVersion,
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

    public record WebhookFile(int schemaVersion,
                                  String webhookId,
                                  String displayName,
                                  String version,
                                  String description,
                                  String releaseNotes,
                                  String owner,
                                  List<String> tags,
                                  String digest,
                                  WebhookTransport transport,
                                  String webhookScriptId,
                                  WebhookSampleRequest sampleRequest,
                                  List<ScriptDependency> scriptDependencies,
                                  String configTemplatePath) {
    }

    public record PlaybookFile(int schemaVersion,
                               String playbookId,
                               String displayName,
                               String version,
                               String description,
                               String releaseNotes,
                               String owner,
                               List<String> tags,
                               String riskLevel,
                               List<String> repositoryIds,
                               List<PlaybookKnowledgeRef> knowledgeRefs,
                               List<PlaybookScriptRef> scriptRefs,
                               List<PlaybookAgentSkillRef> agentSkillRefs,
                               List<PlaybookRelatedRef> relatedPlaybookRefs,
                               String guideMarkdown,
                               List<String> stopConditions,
                               boolean enabled,
                               String digest) {
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
            return (secret || NormalizeUtils.isBlank(defaultValue))
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

    // ------------------------------------------------------------------
    // 静态工具方法
    // ------------------------------------------------------------------

    static String capabilityPackageInstallationId(String repositoryId, String packageId) {
        return NormalizeUtils.normalize(repositoryId, "repositoryId 不能为空") + ":" + NormalizeUtils.normalize(packageId, "packageId 不能为空");
    }

    static String aiPackageInternalId(String repositoryId, String packageId, String kind, String localId) {
        return AI_PACKAGE_INTERNAL_PREFIX
                + NormalizeUtils.normalize(repositoryId, "repositoryId 不能为空")
                + "."
                + NormalizeUtils.normalize(packageId, "packageId 不能为空")
                + "."
                + NormalizeUtils.normalize(kind, "kind 不能为空")
                + "."
                + NormalizeUtils.normalize(localId, "localId 不能为空");
    }

    static void assertPluginVersionAvailable(String repositoryId,
                                             RepositoryIndexFile index,
                                             String pluginId,
                                             String version) {
        assertVersionAvailable(ASSET_TYPE_PLUGIN, repositoryId, index == null ? null : index.plugins(), pluginId, version, RepositoryPluginIndexEntry::id, RepositoryPluginIndexEntry::version);
    }

    static void assertCapabilityPackageVersionAvailable(String repositoryId,
                                                        RepositoryIndexFile index,
                                                        String packageId,
                                                        String version) {
        assertVersionAvailable(ASSET_TYPE_CAPABILITY_PACKAGE, repositoryId, index == null ? null : index.packages(), packageId, version, CapabilityPackageIndexEntry::id, CapabilityPackageIndexEntry::version);
    }

    static void assertSkillVersionAvailable(String repositoryId,
                                            RepositoryIndexFile index,
                                            String skillId,
                                            String version) {
        assertVersionAvailable(ASSET_TYPE_SKILL, repositoryId, index == null ? null : index.skills(), skillId, version, RepositorySkillIndexEntry::id, RepositorySkillIndexEntry::version);
    }

    static void assertWebhookVersionAvailable(String repositoryId,
                                                  RepositoryIndexFile index,
                                                  String webhookId,
                                                  String version) {
        assertVersionAvailable(ASSET_TYPE_WEBHOOK, repositoryId, index == null ? null : index.webhooks(), webhookId, version, RepositoryWebhookIndexEntry::id, RepositoryWebhookIndexEntry::version);
    }

    static void assertPlaybookVersionAvailable(String repositoryId,
                                               RepositoryIndexFile index,
                                               String playbookId,
                                               String version) {
        assertVersionAvailable(ASSET_TYPE_PLAYBOOK, repositoryId, index == null ? null : index.playbooks(), playbookId, version, RepositoryPlaybookIndexEntry::id, RepositoryPlaybookIndexEntry::version);
    }

    private static <T> void assertVersionAvailable(String assetType,
                                                   String repositoryId,
                                                   List<T> entries,
                                                   String assetId,
                                                   String version,
                                                   Function<T, String> idExtractor,
                                                   Function<T, String> versionExtractor) {
        if (entries == null) {
            return;
        }
        entries.stream()
                .filter(entry -> Objects.equals(assetId, idExtractor.apply(entry)) && Objects.equals(version, versionExtractor.apply(entry)))
                .findFirst()
                .ifPresent(entry -> { throw new RepositoryVersionExistsException(assetType, repositoryId, assetId, version); });
    }

    static List<ScriptSchedule> resolvePublishSchedules(String scriptId,
                                                         List<String> scheduleIds,
                                                         ScriptScheduleRepository scheduleRepository) {
        List<ScriptSchedule> schedules = new ArrayList<>();
        for (String scheduleId : NormalizeUtils.nullSafeList(scheduleIds)) {
            String normalizedScheduleId = NormalizeUtils.normalize(scheduleId, "定时任务 ID 不能为空");
            ScriptSchedule schedule = scheduleRepository.findById(normalizedScheduleId)
                    .orElseThrow(() -> new IllegalArgumentException("定时任务不存在: " + normalizedScheduleId));
            if (!Objects.equals(scriptId, schedule.getScriptId())) {
                throw new IllegalArgumentException("定时任务不属于当前脚本: " + normalizedScheduleId);
            }
            schedules.add(schedule);
        }
        return schedules;
    }

    /**
     * 仓库相对路径，提供安全的路径解析和越界检查。
     */
    public record RelativeRepositoryPath(String value) {
        public Path resolve(String child) {
            return resolveInternal(child);
        }

        public RelativeRepositoryPath resolveNullable(String child) {
            if (NormalizeUtils.isBlank(child)) {
                return null;
            }
            Path resolved = resolveInternal(child);
            return new RelativeRepositoryPath(resolved.toString().replace('\\', '/'));
        }

        private Path resolveInternal(String child) {
            if (child != null && child.contains("..")) {
                throw new IllegalArgumentException("仓库文件路径不允许包含 ..: " + child);
            }
            Path resolved = Path.of(value).resolve(child).normalize();
            if (!resolved.startsWith(Path.of(value).normalize())) {
                throw new IllegalArgumentException("仓库文件越界访问被拒绝: " + child);
            }
            return resolved;
        }
    }

    static boolean isTrusted(RepositoryDefinition repository) {
        return REPO_TRUST_TRUSTED.equalsIgnoreCase(repository.getTrustLevel());
    }

    static String resolveRelative(String parentPath, String nestedPath) {
        if (nestedPath == null || nestedPath.isBlank()) {
            return null;
        }
        return java.nio.file.Path.of(parentPath).getParent().resolve(nestedPath).toString().replace('\\', '/');
    }
}
