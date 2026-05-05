package org.team4u.actiondock.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.exception.RepositoryVersionExistsException;
import org.team4u.actiondock.domain.model.AiDependency;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.CapabilityPackageInstallation;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.RepositoryToolInstallation;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.ExecutionPresetRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.CapabilityPackageInstallationRepository;
import org.team4u.actiondock.domain.port.RepositoryDefinitionRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.domain.port.RepositoryToolInstallationRepository;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.repository.RepositoryCatalogTypes;
import org.team4u.actiondock.skill.SkillFileUtils;
import org.team4u.actiondock.skill.SkillArchiveManager;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;
import org.team4u.actiondock.skill.SkillTypes;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Function;

/**
 * 仓库发现、安装、更新和发布服务。
 *
 * @author jay.wu
 */
public class RepositoryCatalogService {
    private static final ObjectMapper METADATA_OBJECT_MAPPER = new ObjectMapper();

    /**
     * 仓库接口分组，将所有仓储端口聚合为一个上下文。
     */
    public record Repositories(
            RepositoryDefinitionRepository repositoryDefinitionRepository,
            RepositoryToolInstallationRepository repositoryToolInstallationRepository,
            CapabilityPackageInstallationRepository capabilityPackageInstallationRepository,
            ScriptRepository scriptRepository,
            ScriptScheduleRepository scriptScheduleRepository,
            ExecutionPresetRepository executionPresetRepository,
            ConfigValueRepository configValueRepository,
            AiModelProfileRepository aiModelProfileRepository,
            AiAgentProfileRepository aiAgentProfileRepository,
            AiToolsetRepository aiToolsetRepository
    ) {}

    /**
     * 应用服务分组，将所有应用层服务聚合为一个上下文。
     */
    public record ApplicationServices(
            ScriptApplicationService scriptApplicationService,
            ConfigValueApplicationService configValueApplicationService,
            PluginRuntimeService pluginRuntimeService
    ) {}

    private final Repositories repos;
    private final ApplicationServices services;
    private final JsonCodec jsonCodec;
    private final HttpClient httpClient;
    private final RepositoryHttpReader httpReader;
    private final PluginArtifactResolverRegistry pluginArtifactResolverRegistry;
    private final Path repositoriesRoot;
    private final RepositoryGitOperations gitOps;
    private final PluginRepositoryPublisher pluginRepositoryPublisher;
    private final SkillRepositoryPublisher skillPublisher;
    private final RepositoryConfigTemplateSyncService configTemplateSyncService;
    private final RepositoryPluginService pluginService;
    private RepositoryCapabilityPackageService capabilityPackageService;
    private RepositoryAiPackageService aiPackageService;

    public RepositoryCatalogService(Repositories repos,
                                    ApplicationServices services,
                                    JsonCodec jsonCodec,
                                    AppProperties properties,
                                    PluginArtifactResolverRegistry pluginArtifactResolverRegistry) {
        this(repos, services, jsonCodec, properties, pluginArtifactResolverRegistry, null);
    }

    public RepositoryCatalogService(Repositories repos,
                                    ApplicationServices services,
                                    JsonCodec jsonCodec,
                                    AppProperties properties,
                                    PluginArtifactResolverRegistry pluginArtifactResolverRegistry,
                                    RepositoryPluginService pluginService) {
        this.repos = repos;
        PluginRuntimeService resolvedPluginRuntimeService = services.pluginRuntimeService() == null ? PluginRuntimeService.disabled() : services.pluginRuntimeService();
        this.services = new ApplicationServices(
                services.scriptApplicationService(),
                services.configValueApplicationService(),
                resolvedPluginRuntimeService
        );
        this.jsonCodec = jsonCodec;
        this.httpClient = HttpClient.newHttpClient();
        this.httpReader = new RepositoryHttpReader(httpClient, jsonCodec);
        this.pluginArtifactResolverRegistry = pluginArtifactResolverRegistry == null
                ? new PluginArtifactResolverRegistry(List.of(new LocalPluginArtifactResolver(), new HttpPluginArtifactResolver()))
                : pluginArtifactResolverRegistry;
        this.repositoriesRoot = SkillFileUtils.normalizePath(Path.of(properties == null || properties.getHomeDir() == null || properties.getHomeDir().isBlank()
                ? AppProperties.defaultHomeDir()
                : properties.getHomeDir()).resolve("repositories"));
        this.gitOps = new RepositoryGitOperations(repositoriesRoot);
        this.aiPackageService = new RepositoryAiPackageService(this, repos, this.services);
        this.pluginRepositoryPublisher = new PluginRepositoryPublisher(this, aiPackageService);
        this.skillPublisher = new SkillRepositoryPublisher(this);
        this.configTemplateSyncService = new RepositoryConfigTemplateSyncService(repos.configValueRepository());
        this.pluginService = pluginService != null ? pluginService
                : new RepositoryPluginService(this, resolvedPluginRuntimeService, repos.scriptRepository(), this.pluginArtifactResolverRegistry);
    }

    public Repositories getRepos() {
        return repos;
    }

    public Path getRepositoriesRoot() {
        return repositoriesRoot;
    }

    public ApplicationServices getServices() {
        return services;
    }

    public RepositoryConfigTemplateSyncService getConfigTemplateSyncService() {
        return configTemplateSyncService;
    }

    public RepositoryAiPackageService getAiPackageService() {
        return aiPackageService;
    }

    public List<RepositoryDefinition> listRepositories() {
        return repos.repositoryDefinitionRepository().findAll().stream()
                .sorted(Comparator.comparing(RepositoryDefinition::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();
    }

    public RepositoryDefinition getRepository(String repositoryId) {
        return repos.repositoryDefinitionRepository().findById(repositoryId)
                .orElseThrow(() -> new IllegalArgumentException("仓库不存在: " + repositoryId));
    }

    public RepositoryDefinition saveRepository(RepositoryDefinition definition) {
        RepositoryDefinition target = definition == null ? new RepositoryDefinition() : definition;
        String id = SkillFileUtils.normalize(target.getId(), "仓库 ID 不能为空");
        String type = validateRepositoryType(target);
        String trustLevel = validateTrustLevel(target);
        String usage = validateRepositoryUsage(target, type);

        LocalDateTime now = LocalDateTime.now();
        RepositoryDefinition existing = repos.repositoryDefinitionRepository().findById(id).orElse(null);
        RepositoryDefinition saved = repos.repositoryDefinitionRepository().save(
                buildRepositoryDefinition(id, target, type, trustLevel, usage, existing, now)
        );
        if ("LOCAL_DIR".equals(type)) {
            ensureLocalDirRepository(saved);
            saved.setLastSyncedAt(now).setUpdatedAt(now);
            return repos.repositoryDefinitionRepository().save(saved);
        }
        return saved;
    }

    private String validateRepositoryType(RepositoryDefinition target) {
        String type = SkillFileUtils.normalizeOrDefault(target.getType(), REPO_TYPE_GIT).toUpperCase(Locale.ROOT);
        if (!List.of(REPO_TYPE_GIT, REPO_TYPE_HTTP, REPO_TYPE_LOCAL_DIR).contains(type)) {
            throw new IllegalArgumentException("仓库类型仅支持 GIT / HTTP / LOCAL_DIR");
        }
        return type;
    }

    private String validateTrustLevel(RepositoryDefinition target) {
        String trustLevel = SkillFileUtils.normalizeOrDefault(target.getTrustLevel(), REPO_TRUST_UNTRUSTED).toUpperCase(Locale.ROOT);
        if (!List.of(REPO_TRUST_TRUSTED, REPO_TRUST_UNTRUSTED).contains(trustLevel)) {
            throw new IllegalArgumentException("trustLevel 仅支持 TRUSTED / UNTRUSTED");
        }
        return trustLevel;
    }

    private String validateRepositoryUsage(RepositoryDefinition target, String type) {
        String usage = SkillFileUtils.normalizeOrDefault(target.getUsage(), REPO_USAGE_DISTRIBUTION).toUpperCase(Locale.ROOT);
        if (!List.of(REPO_USAGE_DISTRIBUTION, REPO_USAGE_DEVELOPMENT).contains(usage)) {
            throw new IllegalArgumentException("usage 仅支持 DISTRIBUTION / DEVELOPMENT");
        }
        if (REPO_TYPE_HTTP.equals(type) && REPO_USAGE_DEVELOPMENT.equals(usage)) {
            throw new IllegalArgumentException("HTTP 仓库不支持作为开发仓库");
        }
        return usage;
    }

    private RepositoryDefinition buildRepositoryDefinition(String id,
                                                                   RepositoryDefinition target,
                                                                   String type,
                                                                   String trustLevel,
                                                                   String usage,
                                                                   RepositoryDefinition existing,
                                                                   LocalDateTime now) {
        return new RepositoryDefinition()
                .setId(id)
                .setName(SkillFileUtils.normalize(target.getName(), "仓库名称不能为空"))
                .setType(type)
                .setUrl(SkillFileUtils.normalize(target.getUrl(), "仓库地址不能为空"))
                .setBranch(REPO_TYPE_GIT.equals(type) ? SkillFileUtils.normalizeOrDefault(target.getBranch(), "main") : null)
                .setEnabled(target.isEnabled())
                .setTrustLevel(trustLevel)
                .setUsage(usage)
                .setDescription(SkillFileUtils.normalizeNullable(target.getDescription()))
                .setLastSyncedAt(existing == null ? null : existing.getLastSyncedAt())
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now);
    }

    public void deleteRepository(String repositoryId) {
        getRepository(repositoryId);
        repos.repositoryDefinitionRepository().deleteById(repositoryId);
    }

    public RepositoryDefinition syncRepository(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        if (REPO_TYPE_GIT.equals(repository.getType())) {
            gitOps.syncGitRepository(repository, resolveRepositoryRoot(repository));
            ensureRepositoryWorkspace(resolveRepositoryRoot(repository), repository, jsonCodec);
        } else if ("LOCAL_DIR".equals(repository.getType())) {
            ensureLocalDirRepository(repository);
        } else {
            readRepositoryIndex(repository);
        }
        repository.setLastSyncedAt(LocalDateTime.now()).setUpdatedAt(LocalDateTime.now());
        return repos.repositoryDefinitionRepository().save(repository);
    }

    public List<RepositoryCatalogTypes.RepositoryToolDescriptor> listAllRepositoryTools() {
        return listAllFromEnabledRepositories(
                this::listRepositoryTools,
                Comparator.comparing(RepositoryCatalogTypes.RepositoryToolDescriptor::installedScriptId));
    }

    public List<RepositoryCatalogTypes.RepositoryToolDescriptor> listRepositoryTools(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        List<RepositoryCatalogTypes.RepositoryToolDescriptor> tools = new ArrayList<>();
        for (RepositoryCatalogTypes.RepositoryIndexEntry entry : safeTools(index)) {
            RepositoryCatalogTypes.ToolFile tool = readToolFile(repository, entry.toolPath());
            tools.add(toDescriptor(repository, tool, entry.toolPath()));
        }
        return tools.stream()
                .sorted(Comparator.comparing(RepositoryCatalogTypes.RepositoryToolDescriptor::installedScriptId))
                .toList();
    }

    public List<RepositoryCatalogTypes.CapabilityPackageDescriptor> listAllCapabilityPackages() {
        return listAllFromEnabledRepositories(
                this::listCapabilityPackages,
                Comparator.comparing(RepositoryCatalogTypes.CapabilityPackageDescriptor::installationId));
    }

    public List<RepositoryCatalogTypes.CapabilityPackageDescriptor> listCapabilityPackages(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        List<RepositoryCatalogTypes.CapabilityPackageDescriptor> packages = new ArrayList<>();
        for (RepositoryCatalogTypes.CapabilityPackageIndexEntry entry : safeCapabilityPackages(index)) {
            RepositoryCatalogTypes.CapabilityPackageManifestFile manifest = readCapabilityPackageManifest(repository, entry.path());
            packages.add(toCapabilityPackageDescriptor(repository, manifest, entry.path()));
        }
        return packages.stream()
                .sorted(Comparator.comparing(RepositoryCatalogTypes.CapabilityPackageDescriptor::installationId))
                .toList();
    }

    public List<RepositoryCatalogTypes.RepositoryPluginDescriptor> listAllRepositoryPlugins() {
        return listAllFromEnabledRepositories(
                this::listRepositoryPlugins,
                Comparator.comparing(RepositoryCatalogTypes.RepositoryPluginDescriptor::pluginId));
    }

    public List<RepositoryCatalogTypes.RepositorySkillDescriptor> listAllRepositorySkills() {
        return listAllFromEnabledRepositories(
                this::listRepositorySkills,
                Comparator.comparing(RepositoryCatalogTypes.RepositorySkillDescriptor::skillId));
    }

    public List<RepositoryCatalogTypes.RepositoryPluginDescriptor> listRepositoryPlugins(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        List<RepositoryCatalogTypes.RepositoryPluginDescriptor> plugins = new ArrayList<>();
        for (RepositoryCatalogTypes.RepositoryPluginIndexEntry entry : safePlugins(index)) {
            RepositoryCatalogTypes.PluginFile plugin = readPluginFile(repository, entry.pluginPath());
            plugins.add(toPluginDescriptor(repository, plugin, entry.pluginPath()));
        }
        return plugins.stream()
                .sorted(Comparator.comparing(RepositoryCatalogTypes.RepositoryPluginDescriptor::pluginId))
                .toList();
    }

    public List<RepositoryCatalogTypes.RepositorySkillDescriptor> listRepositorySkills(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        List<RepositoryCatalogTypes.RepositorySkillDescriptor> skills = new ArrayList<>();
        for (RepositoryCatalogTypes.RepositorySkillIndexEntry entry : safeSkills(index)) {
            RepositoryCatalogTypes.SkillFile skill = readSkillFile(repository, entry.skillPath());
            skills.add(toSkillDescriptor(repository, skill, entry.skillPath()));
        }
        return skills.stream()
                .sorted(Comparator.comparing(RepositoryCatalogTypes.RepositorySkillDescriptor::skillId))
                .toList();
    }

    public RepositoryCatalogTypes.RepositoryPluginDetail getRepositoryPlugin(String repositoryId, String pluginId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositoryCatalogTypes.RepositoryPluginIndexEntry entry = findEntryById(
                safePlugins(index), pluginId, RepositoryCatalogTypes.RepositoryPluginIndexEntry::id, "仓库插件");
        RepositoryCatalogTypes.PluginFile plugin = readPluginFile(repository, entry.pluginPath());
        return new RepositoryCatalogTypes.RepositoryPluginDetail(toPluginDescriptor(repository, plugin, entry.pluginPath()), plugin);
    }

    public RepositoryCatalogTypes.RepositorySkillDetail getRepositorySkill(String repositoryId, String skillId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositoryCatalogTypes.RepositorySkillIndexEntry entry = findEntryById(
                safeSkills(index), skillId, RepositoryCatalogTypes.RepositorySkillIndexEntry::id, "仓库 Skill");
        RepositoryCatalogTypes.SkillFile skill = readSkillFile(repository, entry.skillPath());
        String content = readRepositoryFile(repository, parentDirectoryPath(entry.skillPath()).resolve(skill.entrypointPath()));
        return new RepositoryCatalogTypes.RepositorySkillDetail(toSkillDescriptor(repository, skill, entry.skillPath()), content);
    }

    public RepositoryCatalogTypes.RepositoryBinaryArchive exportRepositorySkillArchive(String repositoryId, String skillId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            throw new IllegalArgumentException(ERR_HTTP_REPO_UNSUPPORTED_EXPORT);
        }
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositoryCatalogTypes.RepositorySkillIndexEntry entry = findEntryById(
                safeSkills(index), skillId, RepositoryCatalogTypes.RepositorySkillIndexEntry::id, "仓库 Skill");
        RepositoryCatalogTypes.SkillFile skill = readSkillFile(repository, entry.skillPath());
        Path skillRoot = safeResolveRepositoryPath(resolveRepositoryRoot(repository), parentDirectoryPath(entry.skillPath()).value());
        SkillTypes.SkillValidationResult validation = SkillFileUtils.validateSkillDirectory(skillRoot, skill.skillId(), true, jsonCodec);
        return new RepositoryCatalogTypes.RepositoryBinaryArchive(
                validation.skillId() + ".zip",
                SkillArchiveManager.buildArchive(skillRoot, validation, validation.version(), jsonCodec)
        );
    }

    public RepositoryCatalogTypes.RepositoryToolDetail getRepositoryTool(String repositoryId, String toolId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositoryCatalogTypes.RepositoryIndexEntry entry = findEntryById(
                safeTools(index), toolId, RepositoryCatalogTypes.RepositoryIndexEntry::id, "仓库工具");
        RepositoryCatalogTypes.ToolFile tool = readToolFile(repository, entry.toolPath());
        List<RepositoryCatalogTypes.ConfigTemplateItem> configTemplate = readOptionalFile(
                repository,
                parentDirectoryPath(entry.toolPath()).resolveNullable(tool.configTemplatePath()),
                RepositoryCatalogTypes.ConfigTemplateItem.class
        );
        List<RepositoryCatalogTypes.ScheduleTemplateItem> scheduleTemplate = readOptionalFile(
                repository,
                parentDirectoryPath(entry.toolPath()).resolveNullable(tool.scheduleTemplatePath()),
                RepositoryCatalogTypes.ScheduleTemplateItem.class
        );
        String source = readRepositoryFile(repository, parentDirectoryPath(entry.toolPath()).resolve(tool.sourcePath()));
        String pythonRequirements = tool.pythonRequirementsPath() == null || tool.pythonRequirementsPath().isBlank()
                ? null
                : readRepositoryFile(repository, parentDirectoryPath(entry.toolPath()).resolve(tool.pythonRequirementsPath()));
        return new RepositoryCatalogTypes.RepositoryToolDetail(toDescriptor(repository, tool, entry.toolPath()), source, pythonRequirements, configTemplate, scheduleTemplate);
    }

    public RepositoryCatalogTypes.CapabilityPackageDetail getCapabilityPackage(String repositoryId, String packageId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositoryCatalogTypes.CapabilityPackageIndexEntry entry = findEntryById(
                safeCapabilityPackages(index), packageId, RepositoryCatalogTypes.CapabilityPackageIndexEntry::id, "仓库能力包");
        RepositoryCatalogTypes.CapabilityPackageManifestFile manifest = readCapabilityPackageManifest(repository, entry.path());
        RepositoryCatalogTypes.CapabilityPackageReleaseFile release = readCapabilityPackageRelease(repository, manifest.latestReleasePath());
        List<RepositoryCatalogTypes.ConfigTemplateItem> configTemplate = readOptionalFile(
                repository,
                parentDirectoryPath(manifest.latestReleasePath()).resolveNullable(release.configTemplatePath()),
                RepositoryCatalogTypes.ConfigTemplateItem.class
        );
        List<RepositoryCatalogTypes.ScheduleTemplateItem> scheduleTemplate = readOptionalFile(
                repository,
                parentDirectoryPath(manifest.latestReleasePath()).resolveNullable(release.scheduleTemplatePath()),
                RepositoryCatalogTypes.ScheduleTemplateItem.class
        );
        List<RepositoryCatalogTypes.CapabilityPackagePresetTemplate> presetTemplate = readOptionalFile(
                repository,
                parentDirectoryPath(manifest.latestReleasePath()).resolveNullable(release.presetTemplatePath()),
                RepositoryCatalogTypes.CapabilityPackagePresetTemplate.class
        );
        return new RepositoryCatalogTypes.CapabilityPackageDetail(
                toCapabilityPackageDescriptor(repository, manifest, entry.path()),
                configTemplate,
                scheduleTemplate,
                presetTemplate,
                release
        );
    }

    boolean isRemoteChanged(ScriptDefinition script, RepositoryCatalogTypes.ToolSourceState state) {
        return !Objects.equals(script.getSourceCommit(), state.commit())
                || !Objects.equals(script.getSourceDigest(), state.digest());
    }

    boolean isLocalChanged(ScriptDefinition script, String localDigest) {
        return !Objects.equals(script.getSourceDigest(), localDigest);
    }

    RepositoryCatalogTypes.DevelopmentSyncState resolveDevelopmentSyncState(ScriptDefinition script, String localDigest, RepositoryCatalogTypes.ToolSourceState remoteState) {
        boolean localChanged = isLocalChanged(script, localDigest);
        boolean remoteChanged = isRemoteChanged(script, remoteState);
        if (localChanged && remoteChanged) {
            return RepositoryCatalogTypes.DevelopmentSyncState.DIVERGED;
        }
        if (localChanged) {
            return RepositoryCatalogTypes.DevelopmentSyncState.LOCAL_CHANGES;
        }
        if (remoteChanged) {
            return RepositoryCatalogTypes.DevelopmentSyncState.REMOTE_CHANGES;
        }
        return RepositoryCatalogTypes.DevelopmentSyncState.SYNCED;
    }

    void ensureDevelopmentRepository(RepositoryDefinition repository) {
        if (!REPO_USAGE_DEVELOPMENT.equalsIgnoreCase(repository.getUsage())) {
            throw new IllegalArgumentException("仓库不是开发仓库: " + repository.getId());
        }
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            throw new IllegalArgumentException("HTTP 仓库不支持开发同步");
        }
    }

    void ensureDevelopmentScript(ScriptDefinition script) {
        if (script.getScope() != ScriptScope.DEVELOPMENT) {
            throw new IllegalArgumentException("脚本不是开发仓库脚本: " + script.getId());
        }
        SkillFileUtils.normalize(script.getRepositoryId(), "开发脚本缺少来源仓库");
        SkillFileUtils.normalize(script.getRepositoryToolId(), "开发脚本缺少来源工具");
    }

    public RepositoryCatalogTypes.RepositoryPluginDescriptor publishPlugin(String repositoryId, RepositoryCatalogTypes.RepositoryPluginPublishRequest request) {
        return pluginRepositoryPublisher.publish(repositoryId, request);
    }

    public RepositoryCatalogTypes.RepositorySkillDescriptor publishSkillArchive(String repositoryId,
                                                         String releaseNotes,
                                                         String fileName,
                                                         byte[] content) {
        return skillPublisher.publish(repositoryId, releaseNotes, fileName, content);
    }

    WritableRepositorySession openWritableRepositorySession(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            throw new IllegalArgumentException(ERR_HTTP_REPO_UNSUPPORTED_PUBLISH);
        }
        if (REPO_TYPE_GIT.equals(repository.getType())) {
            syncRepository(repositoryId);
        } else {
            ensureLocalDirRepository(repository);
        }
        Path root = resolveRepositoryRoot(repository);
        return new WritableRepositorySession(this, repository, root, readRepositoryIndexFile(root, repository));
    }

    ScriptApplicationService scriptApplicationService() {
        return services.scriptApplicationService();
    }

    ConfigValueRepository configValueRepository() {
        return repos.configValueRepository();
    }

    JsonCodec jsonCodec() {
        return jsonCodec;
    }

    void setCapabilityPackageService(RepositoryCapabilityPackageService capabilityPackageService) {
        this.capabilityPackageService = capabilityPackageService;
    }


    void uninstallManagedCapabilityPackageAssets(CapabilityPackageInstallation installation) {
        for (String scriptId : installation.getScriptIds()) {
            repos.scriptScheduleRepository().deleteByScriptId(scriptId);
            repos.scriptRepository().deleteById(scriptId);
        }
        for (String agentId : installation.getAgentIds()) {
            repos.aiAgentProfileRepository().deleteById(agentId);
        }
        for (String toolsetId : installation.getToolsetIds()) {
            repos.aiToolsetRepository().deleteById(toolsetId);
        }
        for (String modelId : installation.getModelIds()) {
            repos.aiModelProfileRepository().deleteById(modelId);
        }
    }

    static String capabilityPackageInstallationId(String repositoryId, String packageId) {
        return SkillFileUtils.normalize(repositoryId, "repositoryId 不能为空") + ":" + SkillFileUtils.normalize(packageId, "packageId 不能为空");
    }

    static String aiPackageInternalId(String repositoryId, String packageId, String kind, String localId) {
        return AI_PACKAGE_INTERNAL_PREFIX
                + SkillFileUtils.normalize(repositoryId, "repositoryId 不能为空")
                + "."
                + SkillFileUtils.normalize(packageId, "packageId 不能为空")
                + "."
                + SkillFileUtils.normalize(kind, "kind 不能为空")
                + "."
                + SkillFileUtils.normalize(localId, "localId 不能为空");
    }

    RepositoryCatalogTypes.ToolSourceState resolveToolSourceState(RepositoryDefinition repository, RepositoryCatalogTypes.RepositoryToolDetail detail) {
        String toolPath = findRepositoryToolPath(repository, detail.descriptor().toolId());
        String digest = computeToolDigest(detail);
        String commit = REPO_TYPE_GIT.equals(repository.getType()) ? gitOps.gitHead(resolveRepositoryRoot(repository)) : null;
        return new RepositoryCatalogTypes.ToolSourceState(parentDirectoryPath(toolPath).value(), commit, digest);
    }

    private String findRepositoryToolPath(RepositoryDefinition repository, String toolId) {
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        return safeTools(index).stream()
                .filter(item -> toolId.equals(item.id()))
                .findFirst()
                .map(RepositoryCatalogTypes.RepositoryIndexEntry::toolPath)
                .orElseThrow(() -> new IllegalArgumentException("仓库工具不存在: " + toolId));
    }

    private String computeToolDigest(RepositoryCatalogTypes.RepositoryToolDetail detail) {
        RepositoryCatalogTypes.RepositoryToolDescriptor d = detail.descriptor();
        return computeToolDigest(d.toolId(), d.displayName(), d.version(), d.type(), d.packaging(),
                d.description(), d.owner(), d.tags(), d.scriptDependencies(), d.pluginDependencies(),
                detail.source(), detail.pythonRequirements(),
                readSchema(d.repositoryId(), d.inputSchemaPath()), readSchema(d.repositoryId(), d.outputSchemaPath()));
    }

    String computeDevelopmentLocalDigest(ScriptDefinition script) {
        return computeToolDigest(script.getRepositoryToolId(), script.getName(), script.getRepositoryVersion(),
                script.getType() == null ? null : script.getType().name(),
                script.getPackaging() == null ? null : script.getPackaging().name(),
                script.getDescription(), script.getOwner(), script.getTags(),
                script.getScriptDependencies(), script.getPluginDependencies(),
                script.getSource(), script.getPythonRequirements(),
                script.getInputSchema(), script.getOutputSchema());
    }

    private String computeToolDigest(String toolId, String displayName, String version,
                                     String type, String packaging, String description, String owner,
                                     Object tags, Object scriptDependencies, Object pluginDependencies,
                                     Object source, Object pythonRequirements,
                                     Object inputSchema, Object outputSchema) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("toolId", toolId);
        values.put("displayName", displayName);
        values.put("version", version);
        values.put("type", type);
        values.put("packaging", packaging);
        values.put("description", description);
        values.put("owner", owner);
        values.put("tags", tags);
        values.put("scriptDependencies", scriptDependencies);
        values.put("pluginDependencies", pluginDependencies);
        values.put("source", source);
        values.put("pythonRequirements", pythonRequirements);
        values.put("inputSchema", inputSchema);
        values.put("outputSchema", outputSchema);
        return RepositoryVersionUtils.sha256(jsonCodec.write(values).getBytes(StandardCharsets.UTF_8));
    }

    Optional<PluginRegistration> findPluginRegistration(String pluginId) {
        return services.pluginRuntimeService().list().stream()
                .filter(item -> pluginId.equals(item.getPluginId()))
                .findFirst()
                .map(item -> services.pluginRuntimeService().getRegistration(pluginId));
    }


    PluginArtifactRef completePluginArtifactRef(String pluginId,
                                                PluginArtifactRef artifact,
                                                RepositoryDefinition repository,
                                                Path repositoryRoot) {
        PluginArtifactRef requested = validatePluginArtifactRef(artifact, false);
        ensureLocalPublishArtifactPresent(pluginId, requested, repository, repositoryRoot);
        PluginArtifact resolved = pluginArtifactResolverRegistry.resolve(
                requested,
                new PluginArtifactContext(repository, null, repositoryRoot)
        );
        if (requested.sha256() != null) {
            RepositoryVersionUtils.verifySha256(pluginId, resolved.content(), requested.sha256());
        }
        RepositoryVersionUtils.verifySize(pluginId, resolved.content(), requested.size());
        return new PluginArtifactRef(
                requested.uri(),
                requested.sha256() == null ? RepositoryVersionUtils.sha256(resolved.content()) : requested.sha256(),
                requested.fileName() == null ? resolved.fileName() : requested.fileName(),
                requested.size() == null ? (long) resolved.content().length : requested.size()
        );
    }

    private void ensureLocalPublishArtifactPresent(String pluginId,
                                                   PluginArtifactRef artifact,
                                                   RepositoryDefinition repository,
                                                   Path repositoryRoot) {
        URI uri = URI.create(artifact.uri());
        if (!"local".equalsIgnoreCase(uri.getScheme()) || REPO_TYPE_HTTP.equals(repository.getType())) {
            return;
        }
        Path target = resolveLocalArtifactPath(repositoryRoot, uri);
        if (Files.exists(target)) {
            return;
        }
        try {
            Files.createDirectories(target.getParent());
            Files.write(target, services.pluginRuntimeService().readPluginFile(pluginId));
        } catch (IOException exception) {
            throw new IllegalStateException("写入本地插件 JAR 失败: " + artifact.uri(), exception);
        }
    }

    private Path resolveLocalArtifactPath(Path repositoryRoot, URI uri) {
        String relativePath = uri.getSchemeSpecificPart();
        if (relativePath != null && relativePath.startsWith("//")) {
            relativePath = relativePath.substring(2);
        }
        if (relativePath != null && relativePath.matches("^[A-Za-z]:[\\\\/].*")) {
            throw new IllegalArgumentException("local artifact 不允许使用绝对路径");
        }
        return safeResolvePath(repositoryRoot, relativePath, "local artifact ");
    }

    PluginArtifactRef validatePluginArtifactRef(PluginArtifactRef artifact, boolean requireSha256) {
        if (artifact == null) {
            throw new IllegalArgumentException("插件 artifact 不能为空");
        }
        String uri = SkillFileUtils.normalize(artifact.uri(), "插件 artifact.uri 不能为空");
        String sha256 = requireSha256
                ? SkillFileUtils.normalize(artifact.sha256(), "插件 artifact.sha256 不能为空")
                : SkillFileUtils.normalizeNullable(artifact.sha256());
        if (artifact.size() != null && artifact.size() < 0) {
            throw new IllegalArgumentException("插件 artifact.size 不能为负数");
        }
        return new PluginArtifactRef(
                uri,
                sha256,
                SkillFileUtils.normalizeNullable(artifact.fileName()),
                artifact.size()
        );
    }

    void updateRepositoryPluginIndex(Path root,
                                     RepositoryDefinition repository,
                                     String pluginId,
                                     String displayName,
                                     RepositoryCatalogTypes.RepositoryPluginPublishRequest request,
                                     String version) {
        RepositoryCatalogTypes.RepositoryIndexFile current = readRepositoryIndexFile(root, repository);
        RepositoryCatalogTypes.RepositoryPluginIndexEntry next = new RepositoryCatalogTypes.RepositoryPluginIndexEntry(
                pluginId,
                displayName,
                version,
                SkillFileUtils.normalizeNullable(request.description()),
                SkillFileUtils.normalizeNullable(request.releaseNotes()),
                "plugins/" + pluginId + "/plugin.json"
        );
        List<RepositoryCatalogTypes.RepositoryPluginIndexEntry> entries =
                RepositoryCatalogTypes.upsertSorted(safePlugins(current), next, RepositoryCatalogTypes.RepositoryPluginIndexEntry::id);
        writeJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryCatalogTypes.withPlugins(current, repository, entries));
    }

    void commitAndPush(RepositoryDefinition repository, String toolId, String version, String releaseNotes) {
        gitOps.commitAndPush(resolveRepositoryRoot(repository), repository, toolId, version, releaseNotes);
    }

    Map<String, Object> readSchema(String repositoryId, String schemaPath) {
        if (schemaPath == null || schemaPath.isBlank()) {
            return Map.of();
        }
        return jsonCodec.readMap(readRepositoryFile(getRepository(repositoryId), Path.of(schemaPath)));
    }

    private RepositoryCatalogTypes.RepositoryToolDescriptor toDescriptor(RepositoryDefinition repository, RepositoryCatalogTypes.ToolFile tool, String toolPath) {
        ScriptDefinition developmentScript = findDevelopmentScript(repository.getId(), tool.id());
        RepositoryCatalogTypes.RepositoryToolDescriptor base = toDescriptorWithoutDevelopment(repository, tool, toolPath);
        if (developmentScript == null) {
            return base;
        }
        DevelopmentInfo devInfo = resolveDevelopmentInfo(repository, tool, toolPath, developmentScript, base);
        return base.withDevelopment(
                developmentScript.getId(),
                devInfo.dirty(),
                devInfo.remoteChanged(),
                devInfo.syncState()
        );
    }

    /**
     * 查找与仓库工具关联的开发脚本。
     */
    private ScriptDefinition findDevelopmentScript(String repositoryId, String toolId) {
        return repos.scriptRepository().findAll().stream()
                .filter(script -> script.getScope() == ScriptScope.DEVELOPMENT)
                .filter(script -> repositoryId.equals(script.getRepositoryId()))
                .filter(script -> toolId.equals(script.getRepositoryToolId()))
                .findFirst()
                .orElse(null);
    }

    /**
     * 解析开发脚本的同步状态信息。
     *
     * @return 数组: [developmentDirty, developmentRemoteChanged, developmentSyncState]
     */
    private record DevelopmentInfo(boolean dirty, boolean remoteChanged, String syncState) {
    }

    private DevelopmentInfo resolveDevelopmentInfo(RepositoryDefinition repository,
                                            RepositoryCatalogTypes.ToolFile tool,
                                            String toolPath,
                                            ScriptDefinition developmentScript,
                                            RepositoryCatalogTypes.RepositoryToolDescriptor base) {
        RepositoryCatalogTypes.ToolSourceState state = resolveToolSourceState(repository, new RepositoryCatalogTypes.RepositoryToolDetail(
                base,
                readRepositoryFile(repository, parentDirectoryPath(toolPath).resolve(tool.sourcePath())),
                tool.pythonRequirementsPath() == null ? null : readRepositoryFile(repository, parentDirectoryPath(toolPath).resolve(tool.pythonRequirementsPath())),
                List.of(),
                List.of()
        ));
        String localDigest = computeDevelopmentLocalDigest(developmentScript);
        RepositoryCatalogTypes.DevelopmentSyncState syncState = resolveDevelopmentSyncState(developmentScript, localDigest, state);
        return new DevelopmentInfo(
                isLocalChanged(developmentScript, localDigest),
                isRemoteChanged(developmentScript, state),
                syncState == null ? null : syncState.name()
        );
    }

    private RepositoryCatalogTypes.RepositoryToolDescriptor toDescriptorWithoutDevelopment(RepositoryDefinition repository, RepositoryCatalogTypes.ToolFile tool, String toolPath) {
        String installedScriptId = repository.getId() + "." + tool.id();
        RepositoryToolInstallation installation = repos.repositoryToolInstallationRepository().findByToolId(installedScriptId).orElse(null);
        boolean installed = installation != null;
        return new RepositoryCatalogTypes.RepositoryToolDescriptor(
                repository.getId(), tool.id(), installedScriptId,
                tool.name(), tool.version(), tool.description(), tool.releaseNotes(), tool.owner(),
                nullSafeList(tool.tags()),
                tool.type(), resolvePackaging(tool.packaging()).name(), tool.sourcePath(),
                resolveRelative(toolPath, tool.pythonRequirementsPath()),
                resolveRelative(toolPath, tool.inputSchemaPath()),
                resolveRelative(toolPath, tool.outputSchemaPath()),
                resolveRelative(toolPath, tool.configTemplatePath()),
                resolveRelative(toolPath, tool.scheduleTemplatePath()),
                tool.digest(), tool.riskLevel(),
                nullSafeList(tool.scriptDependencies()), nullSafeList(tool.pluginDependencies()),
                installed,
                installed ? installation.getVersion() : null,
                installed && !Objects.equals(installation.getVersion(), tool.version()),
                REPO_TRUST_TRUSTED.equalsIgnoreCase(repository.getTrustLevel()),
                SkillFileUtils.normalizeOrDefault(repository.getUsage(), REPO_USAGE_DISTRIBUTION),
                null, false, false, null
        );
    }

    private RepositoryCatalogTypes.CapabilityPackageDescriptor toCapabilityPackageDescriptor(RepositoryDefinition repository,
                                                                      RepositoryCatalogTypes.CapabilityPackageManifestFile manifest,
                                                                      String manifestPath) {
        String packageId = SkillFileUtils.normalize(manifest.packageId(), "能力包 ID 不能为空");
        String installationId = capabilityPackageInstallationId(repository.getId(), packageId);
        CapabilityPackageInstallation installation = repos.capabilityPackageInstallationRepository().findByInstallationId(installationId).orElse(null);
        return new RepositoryCatalogTypes.CapabilityPackageDescriptor(
                repository.getId(),
                packageId,
                installationId,
                manifest.displayName(),
                manifest.latestVersion(),
                manifest.description(),
                manifest.releaseNotes(),
                manifest.owner(),
                manifest.tags() == null ? List.of() : manifest.tags(),
                manifest.riskLevel(),
                manifest.entries() == null ? List.of() : manifest.entries(),
                manifestPath,
                manifest.latestReleasePath(),
                installation != null,
                installation == null ? null : installation.getVersion(),
                installation != null && !Objects.equals(installation.getVersion(), manifest.latestVersion()),
                REPO_TRUST_TRUSTED.equalsIgnoreCase(repository.getTrustLevel()),
                SkillFileUtils.normalizeOrDefault(repository.getUsage(), REPO_USAGE_DISTRIBUTION)
        );
    }

    ScriptPackaging resolvePackaging(String packaging) {
        if (packaging == null || packaging.isBlank()) {
            return ScriptPackaging.TOOL;
        }
        return ScriptPackaging.valueOf(packaging.trim().toUpperCase(Locale.ROOT));
    }

    void assertPackagingConstraints(ScriptDefinition script) {
        if (script.getPackaging() != ScriptPackaging.TOOL) {
            return;
        }
        List<AiDependency> dependencies = Optional.ofNullable(script.getPublishedSnapshot())
                .map(PublishedScriptSnapshot::getAiDependencies)
                .orElseGet(script::getAiDependencies);
        boolean usesAgent = dependencies.stream().anyMatch(AiPackageDependencyCollector::isAgentDependency);
        if (usesAgent) {
            throw new IllegalArgumentException("TOOL 类型脚本不能依赖 Agent，请将脚本 packaging 改为 FLOW");
        }
    }

    private RepositoryCatalogTypes.RepositoryPluginDescriptor toPluginDescriptor(RepositoryDefinition repository, RepositoryCatalogTypes.PluginFile plugin, String pluginPath) {
        PluginRegistration registration = findPluginRegistration(plugin.pluginId()).orElse(null);
        return new RepositoryCatalogTypes.RepositoryPluginDescriptor(
                repository.getId(),
                plugin.pluginId(),
                plugin.name(),
                plugin.version(),
                plugin.description(),
                plugin.releaseNotes(),
                plugin.owner(),
                plugin.tags() == null ? List.of() : plugin.tags(),
                plugin.artifact(),
                plugin.riskLevel(),
                registration != null,
                registration == null ? null : registration.getVersion(),
                registration != null && !Objects.equals(registration.getVersion(), plugin.version()),
                REPO_TRUST_TRUSTED.equalsIgnoreCase(repository.getTrustLevel()),
                dependentToolCount(plugin.pluginId())
        );
    }

    private RepositoryCatalogTypes.RepositorySkillDescriptor toSkillDescriptor(RepositoryDefinition repository, RepositoryCatalogTypes.SkillFile skill, String skillPath) {
        return new RepositoryCatalogTypes.RepositorySkillDescriptor(
                repository.getId(),
                SkillFileUtils.normalize(skill.skillId(), "skillId 不能为空"),
                SkillFileUtils.normalizeOrDefault(skill.displayName(), skill.skillId()),
                SkillFileUtils.normalize(skill.version(), SkillFileUtils.ERR_VERSION_REQUIRED),
                SkillFileUtils.normalizeNullable(skill.description()),
                null,
                SkillFileUtils.normalizeNullable(skill.owner()),
                skill.tags() == null ? List.of() : skill.tags(),
                skillPath,
                resolveRelative(skillPath, SkillFileUtils.normalizeOrDefault(skill.entrypointPath(), SkillFileUtils.SKILL_MANIFEST_FILE)),
                SkillFileUtils.normalizeNullable(skill.digest()),
                SkillFileUtils.normalizeNullable(skill.riskLevel()),
                REPO_TRUST_TRUSTED.equalsIgnoreCase(repository.getTrustLevel()),
                repository.getUsage()
        );
    }

    private int dependentToolCount(String pluginId) {
        int count = 0;
        for (ScriptDefinition script : repos.scriptRepository().findAll()) {
            boolean dependsOnPlugin = script.getPluginDependencies().stream()
                    .anyMatch(dependency -> pluginId.equals(dependency.getPluginId()));
            if (dependsOnPlugin) {
                count++;
            }
        }
        return count;
    }


    void ensureLocalDirRepository(RepositoryDefinition repository) {
        Path root = resolveRepositoryRoot(repository);
        ensureRepositoryWorkspace(root, repository, jsonCodec);
    }

    RepositoryCatalogTypes.RepositoryIndexFile readRepositoryIndex(RepositoryDefinition repository) {
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            return readHttpJson(httpReader.joinHttpPath(repository.getUrl(), REPOSITORY_INDEX_FILE), RepositoryCatalogTypes.RepositoryIndexFile.class);
        }
        Path root = resolveRepositoryRoot(repository);
        if ("LOCAL_DIR".equals(repository.getType())) {
            ensureLocalDirRepository(repository);
        }
        if (REPO_TYPE_GIT.equals(repository.getType()) && Files.notExists(root)) {
            gitOps.syncGitRepository(repository, root);
        }
        if (REPO_TYPE_GIT.equals(repository.getType())) {
            ensureRepositoryWorkspace(root, repository, jsonCodec);
        }
        return readJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryCatalogTypes.RepositoryIndexFile.class);
    }

    private <T> T readRepositoryJsonFile(RepositoryDefinition repository, String relativePath, Class<T> type) {
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            return readHttpJson(httpReader.joinHttpPath(repository.getUrl(), relativePath), type);
        }
        return readJson(safeResolveRepositoryPath(resolveRepositoryRoot(repository), relativePath), type);
    }

    private RepositoryCatalogTypes.ToolFile readToolFile(RepositoryDefinition repository, String toolPath) {
        return readRepositoryJsonFile(repository, toolPath, RepositoryCatalogTypes.ToolFile.class);
    }

    RepositoryCatalogTypes.PluginFile readPluginFile(RepositoryDefinition repository, String pluginPath) {
        return readRepositoryJsonFile(repository, pluginPath, RepositoryCatalogTypes.PluginFile.class);
    }

    RepositoryCatalogTypes.SkillFile readSkillFile(RepositoryDefinition repository, String skillPath) {
        return readRepositoryJsonFile(repository, skillPath, RepositoryCatalogTypes.SkillFile.class);
    }

    private RepositoryCatalogTypes.CapabilityPackageManifestFile readCapabilityPackageManifest(RepositoryDefinition repository, String manifestPath) {
        return readRepositoryJsonFile(repository, manifestPath, RepositoryCatalogTypes.CapabilityPackageManifestFile.class);
    }

    private RepositoryCatalogTypes.CapabilityPackageReleaseFile readCapabilityPackageRelease(RepositoryDefinition repository, String releasePath) {
        return readRepositoryJsonFile(repository, releasePath, RepositoryCatalogTypes.CapabilityPackageReleaseFile.class);
    }

    String readRepositoryFile(RepositoryDefinition repository, Path path) {
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            return readHttpText(httpReader.joinHttpPath(repository.getUrl(), path.toString().replace('\\', '/')));
        }
        try {
            return Files.readString(safeResolveRepositoryPath(resolveRepositoryRoot(repository), path.toString()), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new IllegalStateException("读取仓库文件失败: " + path, exception);
        }
    }

    private <T> List<T> readOptionalFile(RepositoryDefinition repository, RelativeRepositoryPath path, Class<T> elementType) {
        if (path == null || path.value() == null || path.value().isBlank()) {
            return List.of();
        }
        String raw = readRepositoryFile(repository, Path.of(path.value()));
        return jsonCodec.readList(raw, elementType);
    }

    Path resolveRepositoryRoot(RepositoryDefinition repository) {
        if ("LOCAL_DIR".equals(repository.getType())) {
            return Path.of(repository.getUrl());
        }
        return repositoriesRoot.resolve(repository.getId());
    }

    /**
     * 安全地解析仓库相对路径，防止路径遍历攻击。
     * <p>
     * 拒绝绝对路径、空路径、包含 {@code ..} 的路径，
     * 并通过 normalize/toRealPath 确认解析后仍在仓库根目录下。
     */
    Path safeResolveRepositoryPath(Path root, String relativePath) {
        return safeResolvePath(root, relativePath, "仓库文件路径");
    }

    private static Path safeResolvePath(Path root, String relativePath, String context) {
        RepositoryVersionUtils.validateRelativePath(relativePath, context);
        Path parsed = Path.of(relativePath);
        Path normalizedRoot = SkillFileUtils.normalizePath(root);
        Path target = normalizedRoot.resolve(parsed).normalize();
        if (!target.startsWith(normalizedRoot)) {
            throw new IllegalArgumentException(context + "越界访问被拒绝: " + relativePath);
        }
        return target;
    }

    <T> T readJson(Path path, Class<T> type) {
        try (InputStream stream = Files.newInputStream(path)) {
            String raw = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
            assertLatestRepositoryMetadata(raw, type, path.toString());
            return jsonCodec.read(raw, type);
        } catch (IOException exception) {
            throw new IllegalStateException("读取仓库文件失败: " + path, exception);
        }
    }

    private <T> T readHttpJson(String url, Class<T> type) {
        return httpReader.readHttpJson(url, type);
    }

    static void assertLatestRepositoryMetadata(String raw, Class<?> type, String source) {
        if (type != RepositoryCatalogTypes.RepositoryIndexFile.class
                && type != RepositoryCatalogTypes.ToolFile.class
                && type != RepositoryCatalogTypes.PluginFile.class
                && type != RepositoryCatalogTypes.SkillFile.class
                && type != RepositoryCatalogTypes.CapabilityPackageManifestFile.class
                && type != RepositoryCatalogTypes.CapabilityPackageReleaseFile.class) {
            return;
        }
        JsonNode root;
        try {
            root = METADATA_OBJECT_MAPPER.readTree(raw);
        } catch (JsonProcessingException exception) {
            return;
        }
        if (root == null || !root.isObject()) {
            return;
        }
        if (type == RepositoryCatalogTypes.RepositoryIndexFile.class) {
            assertRepositoryIndexEntriesIncludeReleaseNotes(root.get("tools"), source, "tools");
            assertRepositoryIndexEntriesIncludeReleaseNotes(root.get("plugins"), source, "plugins");
            assertRepositoryIndexEntriesIncludeReleaseNotes(root.get("packages"), source, "packages");
            assertRepositoryIndexEntriesIncludeReleaseNotes(root.get("skills"), source, "skills");
            return;
        }
        assertReleaseNotesField(root, source, "releaseNotes");
    }

    private static void assertRepositoryIndexEntriesIncludeReleaseNotes(JsonNode entries, String source, String fieldName) {
        if (entries == null || !entries.isArray()) {
            return;
        }
        for (int index = 0; index < entries.size(); index++) {
            JsonNode entry = entries.get(index);
            if (entry != null && entry.isObject()) {
                assertReleaseNotesField(entry, source, fieldName + "[" + index + "].releaseNotes");
            }
        }
    }

    private static void assertReleaseNotesField(JsonNode node, String source, String path) {
        if (!node.has("releaseNotes")) {
            throw new IllegalArgumentException("仓库元数据缺少 releaseNotes 字段: " + source + " " + path);
        }
    }

    private String readHttpText(String url) {
        return httpReader.readHttpText(url);
    }

    void writeJson(Path path, Object value) {
        try {
            Files.createDirectories(path.getParent());
            Files.writeString(path, jsonCodec.write(value), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new IllegalStateException("写入 JSON 文件失败: " + path, exception);
        }
    }

    static void ensureRepositoryWorkspace(Path root, RepositoryDefinition repository, JsonCodec jsonCodec) {
        try {
            Files.createDirectories(root);
            Files.createDirectories(root.resolve("tools"));
            Files.createDirectories(root.resolve("plugins"));
            Files.createDirectories(root.resolve(CAPABILITY_PACKAGES_DIR));
            Files.createDirectories(root.resolve(SKILLS_DIR));
        } catch (IOException exception) {
            throw new IllegalStateException("初始化仓库目录失败: " + root, exception);
        }
        Path indexPath = root.resolve(REPOSITORY_INDEX_FILE);
        if (Files.exists(indexPath)) {
            return;
        }
        try {
            Files.writeString(indexPath, jsonCodec.write(emptyRepositoryIndex(repository)), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new IllegalStateException("初始化仓库索引失败: " + indexPath, exception);
        }
    }

    static RepositoryCatalogTypes.RepositoryIndexFile emptyRepositoryIndex(RepositoryDefinition repository) {
        String repositoryName = SkillFileUtils.normalizeNullable(repository == null ? null : repository.getName());
        String repositoryId = SkillFileUtils.normalizeNullable(repository == null ? null : repository.getId());
        return new RepositoryCatalogTypes.RepositoryIndexFile(
                1,
                repositoryName != null ? repositoryName : repositoryId,
                SkillFileUtils.normalizeNullable(repository == null ? null : repository.getDescription()),
                new ArrayList<>(),
                new ArrayList<>(),
                new ArrayList<>(),
                new ArrayList<>()
        );
    }

    private <T> List<T> listAllFromEnabledRepositories(Function<String, List<T>> lister, Comparator<T> comparator) {
        List<T> result = new ArrayList<>();
        for (RepositoryDefinition repository : listRepositories()) {
            if (!repository.isEnabled()) {
                continue;
            }
            result.addAll(lister.apply(repository.getId()));
        }
        return result.stream().sorted(comparator).toList();
    }

    private static <E> E findEntryById(List<E> entries, String id, Function<E, String> idExtractor, String label) {
        return entries.stream()
                .filter(item -> id.equals(idExtractor.apply(item)))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(label + "不存在: " + id));
    }


    static String resolveRelative(String toolPath, String nestedPath) {
        if (nestedPath == null || nestedPath.isBlank()) {
            return null;
        }
        return Path.of(toolPath).getParent().resolve(nestedPath).toString().replace('\\', '/');
    }


    List<RepositoryCatalogTypes.RepositoryIndexEntry> safeTools(RepositoryCatalogTypes.RepositoryIndexFile index) {
        return safeList(index, RepositoryCatalogTypes.RepositoryIndexFile::tools);
    }

    List<RepositoryCatalogTypes.RepositoryPluginIndexEntry> safePlugins(RepositoryCatalogTypes.RepositoryIndexFile index) {
        return safeList(index, RepositoryCatalogTypes.RepositoryIndexFile::plugins);
    }

    List<RepositoryCatalogTypes.CapabilityPackageIndexEntry> safeCapabilityPackages(RepositoryCatalogTypes.RepositoryIndexFile index) {
        return safeList(index, RepositoryCatalogTypes.RepositoryIndexFile::packages);
    }

    List<RepositoryCatalogTypes.RepositorySkillIndexEntry> safeSkills(RepositoryCatalogTypes.RepositoryIndexFile index) {
        return safeList(index, RepositoryCatalogTypes.RepositoryIndexFile::skills);
    }

    private static <S, T> List<T> safeList(S source, java.util.function.Function<S, List<T>> extractor) {
        return source == null ? List.of() : nullSafeList(extractor.apply(source));
    }

    RepositoryCatalogTypes.RepositoryIndexFile readRepositoryIndexFile(Path root, RepositoryDefinition repository) {
        return Files.exists(root.resolve(REPOSITORY_INDEX_FILE))
                ? readJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryCatalogTypes.RepositoryIndexFile.class)
                : emptyRepositoryIndex(repository);
    }

    static void assertPluginVersionAvailable(String repositoryId,
                                             RepositoryCatalogTypes.RepositoryIndexFile index,
                                             String pluginId,
                                             String version) {
        assertVersionAvailable("PLUGIN", repositoryId, index == null ? null : index.plugins(), pluginId, version, RepositoryCatalogTypes.RepositoryPluginIndexEntry::id, RepositoryCatalogTypes.RepositoryPluginIndexEntry::version);
    }

    static void assertCapabilityPackageVersionAvailable(String repositoryId,
                                                        RepositoryCatalogTypes.RepositoryIndexFile index,
                                                        String packageId,
                                                        String version) {
        assertVersionAvailable("CAPABILITY_PACKAGE", repositoryId, index == null ? null : index.packages(), packageId, version, RepositoryCatalogTypes.CapabilityPackageIndexEntry::id, RepositoryCatalogTypes.CapabilityPackageIndexEntry::version);
    }

    static void assertSkillVersionAvailable(String repositoryId,
                                            RepositoryCatalogTypes.RepositoryIndexFile index,
                                            String skillId,
                                            String version) {
        assertVersionAvailable("SKILL", repositoryId, index == null ? null : index.skills(), skillId, version, RepositoryCatalogTypes.RepositorySkillIndexEntry::id, RepositoryCatalogTypes.RepositorySkillIndexEntry::version);
    }

    static List<ScriptSchedule> resolvePublishSchedules(String scriptId,
                                                         List<String> scheduleIds,
                                                         ScriptScheduleRepository scheduleRepository) {
        List<ScriptSchedule> schedules = new ArrayList<>();
        for (String scheduleId : nullSafeList(scheduleIds)) {
            String normalizedScheduleId = SkillFileUtils.normalize(scheduleId, "定时任务 ID 不能为空");
            ScriptSchedule schedule = scheduleRepository.findById(normalizedScheduleId)
                    .orElseThrow(() -> new IllegalArgumentException("定时任务不存在: " + normalizedScheduleId));
            if (!Objects.equals(scriptId, schedule.getScriptId())) {
                throw new IllegalArgumentException("定时任务不属于当前脚本: " + normalizedScheduleId);
            }
            schedules.add(schedule);
        }
        return schedules;
    }

    private static <T> void assertVersionAvailable(String assetType,
                                                   String repositoryId,
                                                   List<T> entries,
                                                   String assetId,
                                                   String version,
                                                   java.util.function.Function<T, String> idExtractor,
                                                   java.util.function.Function<T, String> versionExtractor) {
        if (entries == null) {
            return;
        }
        for (T entry : entries) {
            if (Objects.equals(assetId, idExtractor.apply(entry)) && Objects.equals(version, versionExtractor.apply(entry))) {
                throw new RepositoryVersionExistsException(assetType, repositoryId, assetId, version);
            }
        }
    }

    RelativeRepositoryPath parentDirectoryPath(String filePath) {
        return new RelativeRepositoryPath(Path.of(filePath).getParent().toString().replace('\\', '/'));
    }

    private record RelativeRepositoryPath(String value) {
        private Path resolve(String child) {
            return resolveInternal(child);
        }

        private RelativeRepositoryPath resolveNullable(String child) {
            if (child == null || child.isBlank()) {
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
}
