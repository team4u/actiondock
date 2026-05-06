package org.team4u.actiondock.repository;

import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.config.AppProperties;
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
import org.team4u.actiondock.domain.port.ManagedSkillRepository;
import org.team4u.actiondock.domain.port.RepositoryDefinitionRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.domain.port.RepositoryToolInstallationRepository;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
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

    /**
     * 仓库接口分组，将所有仓储端口聚合为一个上下文。
     */
    public record Repositories(
            RepositoryDefinitionRepository repositoryDefinitionRepository,
            RepositoryToolInstallationRepository repositoryToolInstallationRepository,
            CapabilityPackageInstallationRepository capabilityPackageInstallationRepository,
            ManagedSkillRepository managedSkillRepository,
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
    private final RepositoryDefinitionService definitionService;
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
        this.repositoriesRoot = NormalizeUtils.normalizePath(Path.of(properties == null || NormalizeUtils.isBlank(properties.getHomeDir())
                ? AppProperties.defaultHomeDir()
                : properties.getHomeDir()).resolve("repositories"));
        this.gitOps = new RepositoryGitOperations(repositoriesRoot);
        this.definitionService = new RepositoryDefinitionService(repos.repositoryDefinitionRepository(), jsonCodec, repositoriesRoot);
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

    private RepositorySkillService skillService() {
        return new RepositorySkillService(this, jsonCodec, repositoriesRoot);
    }

    public List<RepositoryDefinition> listRepositories() {
        return definitionService.listRepositories();
    }

    public RepositoryDefinition getRepository(String repositoryId) {
        return definitionService.getRepository(repositoryId);
    }

    public RepositoryDefinition saveRepository(RepositoryDefinition definition) {
        return definitionService.saveRepository(definition);
    }

    public void deleteRepository(String repositoryId) {
        definitionService.deleteRepository(repositoryId);
    }

    public RepositoryDefinition syncRepository(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        switch (repository.getType()) {
            case REPO_TYPE_GIT -> {
                Path root = resolveRepositoryRoot(repository);
                gitOps.syncGitRepository(repository, root);
                RepositoryWorkspaceHelper.ensureRepositoryWorkspace(root, repository, jsonCodec);
            }
            case REPO_TYPE_LOCAL_DIR -> ensureLocalDirRepository(repository);
            default -> readRepositoryIndex(repository);
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
        return index.safeTools().stream()
                .map(entry -> toDescriptor(repository, readToolFile(repository, entry.toolPath()), entry.toolPath()))
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
        return index.safeCapabilityPackages().stream()
                .map(entry -> toCapabilityPackageDescriptor(repository, readCapabilityPackageManifest(repository, entry.path()), entry.path()))
                .sorted(Comparator.comparing(RepositoryCatalogTypes.CapabilityPackageDescriptor::installationId))
                .toList();
    }

    public List<RepositoryCatalogTypes.RepositoryPluginDescriptor> listAllRepositoryPlugins() {
        return listAllFromEnabledRepositories(
                this::listRepositoryPlugins,
                Comparator.comparing(RepositoryCatalogTypes.RepositoryPluginDescriptor::pluginId));
    }

    public List<RepositoryCatalogTypes.RepositoryPluginDescriptor> listRepositoryPlugins(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        return index.safePlugins().stream()
                .map(entry -> toPluginDescriptor(repository, readPluginFile(repository, entry.pluginPath()), entry.pluginPath()))
                .sorted(Comparator.comparing(RepositoryCatalogTypes.RepositoryPluginDescriptor::pluginId))
                .toList();
    }

    public RepositoryCatalogTypes.RepositoryPluginDetail getRepositoryPlugin(String repositoryId, String pluginId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositoryCatalogTypes.RepositoryPluginIndexEntry entry = findEntryById(
                index.safePlugins(), pluginId, RepositoryCatalogTypes.RepositoryPluginIndexEntry::id, "仓库插件");
        RepositoryCatalogTypes.PluginFile plugin = readPluginFile(repository, entry.pluginPath());
        return new RepositoryCatalogTypes.RepositoryPluginDetail(toPluginDescriptor(repository, plugin, entry.pluginPath()), plugin);
    }

    public RepositoryCatalogTypes.RepositorySkillDetail getRepositorySkill(String repositoryId, String skillId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositoryCatalogTypes.RepositorySkillIndexEntry entry = findEntryById(
                index.safeSkills(), skillId, RepositoryCatalogTypes.RepositorySkillIndexEntry::id, "仓库 Skill");
        RepositoryCatalogTypes.SkillFile skill = readSkillFile(repository, entry.skillPath());
        String content = readRepositoryFile(repository, parentDirectoryPath(entry.skillPath()).resolve(skill.entrypointPath()));
        return new RepositoryCatalogTypes.RepositorySkillDetail(skillService().toSkillDescriptor(repository, skill, entry.skillPath()), content);
    }

    public RepositoryCatalogTypes.RepositoryToolDetail getRepositoryTool(String repositoryId, String toolId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositoryCatalogTypes.RepositoryIndexEntry entry = findEntryById(
                index.safeTools(), toolId, RepositoryCatalogTypes.RepositoryIndexEntry::id, "仓库工具");
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
        String pythonRequirements = NormalizeUtils.isBlank(tool.pythonRequirementsPath())
                ? null
                : readRepositoryFile(repository, parentDirectoryPath(entry.toolPath()).resolve(tool.pythonRequirementsPath()));
        return new RepositoryCatalogTypes.RepositoryToolDetail(toDescriptor(repository, tool, entry.toolPath()), source, pythonRequirements, configTemplate, scheduleTemplate);
    }

    public RepositoryCatalogTypes.CapabilityPackageDetail getCapabilityPackage(String repositoryId, String packageId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositoryCatalogTypes.CapabilityPackageIndexEntry entry = findEntryById(
                index.safeCapabilityPackages(), packageId, RepositoryCatalogTypes.CapabilityPackageIndexEntry::id, "仓库能力包");
        RepositoryCatalogTypes.CapabilityPackageManifestFile manifest = readCapabilityPackageManifest(repository, entry.path());
        RepositoryCatalogTypes.CapabilityPackageReleaseFile release = readRepositoryJsonFile(repository, manifest.latestReleasePath(), RepositoryCatalogTypes.CapabilityPackageReleaseFile.class);
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
        deleteAllByIds(installation.getAgentIds(), repos.aiAgentProfileRepository()::deleteById);
        deleteAllByIds(installation.getToolsetIds(), repos.aiToolsetRepository()::deleteById);
        deleteAllByIds(installation.getModelIds(), repos.aiModelProfileRepository()::deleteById);
        deleteAllByIds(installation.getScheduleIds(), repos.scriptScheduleRepository()::deleteById);
    }

    private static void deleteAllByIds(List<String> ids, java.util.function.Consumer<String> deleter) {
        for (String id : ids) {
            deleter.accept(id);
        }
    }

    RepositoryCatalogTypes.ToolSourceState resolveToolSourceState(RepositoryDefinition repository, RepositoryCatalogTypes.RepositoryToolDetail detail) {
        String toolId = detail.descriptor().toolId();
        String toolPath = readRepositoryIndex(repository).safeTools().stream()
                .filter(item -> toolId.equals(item.id()))
                .findFirst()
                .map(RepositoryCatalogTypes.RepositoryIndexEntry::toolPath)
                .orElseThrow(() -> new IllegalArgumentException("仓库工具不存在: " + toolId));
        String digest = computeToolDigest(detail);
        String commit = REPO_TYPE_GIT.equals(repository.getType()) ? gitOps.gitHead(resolveRepositoryRoot(repository)) : null;
        return new RepositoryCatalogTypes.ToolSourceState(parentDirectoryPath(toolPath).value(), commit, digest);
    }

    private String computeToolDigest(RepositoryCatalogTypes.RepositoryToolDetail detail) {
        RepositoryCatalogTypes.RepositoryToolDescriptor d = detail.descriptor();
        return computeDigest(
                d.toolId(), d.displayName(), d.version(), d.type(), d.packaging(),
                d.description(), d.owner(), d.tags(),
                d.scriptDependencies(), d.pluginDependencies(),
                detail.source(), detail.pythonRequirements(),
                readSchema(d.repositoryId(), d.inputSchemaPath()),
                readSchema(d.repositoryId(), d.outputSchemaPath())
        );
    }

    String computeDevelopmentLocalDigest(ScriptDefinition script) {
        return computeDigest(
                script.getRepositoryToolId(), script.getName(), script.getRepositoryVersion(),
                script.getType() == null ? null : script.getType().name(),
                script.getPackaging() == null ? null : script.getPackaging().name(),
                script.getDescription(), script.getOwner(), script.getTags(),
                script.getScriptDependencies(), script.getPluginDependencies(),
                script.getSource(), script.getPythonRequirements(),
                script.getInputSchema(), script.getOutputSchema()
        );
    }

    private String computeDigest(String toolId, String displayName, String version,
                                  String type, String packaging, String description,
                                  String owner, List<String> tags,
                                  List<?> scriptDependencies, List<?> pluginDependencies,
                                  String source, String pythonRequirements,
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
        return services.pluginRuntimeService().findPluginRegistration(pluginId);
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
        if (!LOCAL_ARTIFACT_SCHEME.equalsIgnoreCase(uri.getScheme()) || REPO_TYPE_HTTP.equals(repository.getType())) {
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
        if (relativePath != null && relativePath.matches(WINDOWS_ABSOLUTE_PATH_REGEX)) {
            throw new IllegalArgumentException("local artifact 不允许使用绝对路径");
        }
        return safeResolvePath(repositoryRoot, relativePath, "local artifact ");
    }

    PluginArtifactRef validatePluginArtifactRef(PluginArtifactRef artifact, boolean requireSha256) {
        if (artifact == null) {
            throw new IllegalArgumentException("插件 artifact 不能为空");
        }
        String uri = NormalizeUtils.normalize(artifact.uri(), "插件 artifact.uri 不能为空");
        String sha256 = requireSha256
                ? NormalizeUtils.normalize(artifact.sha256(), "插件 artifact.sha256 不能为空")
                : NormalizeUtils.normalizeNullable(artifact.sha256());
        if (artifact.size() != null && artifact.size() < 0) {
            throw new IllegalArgumentException("插件 artifact.size 不能为负数");
        }
        return new PluginArtifactRef(
                uri,
                sha256,
                NormalizeUtils.normalizeNullable(artifact.fileName()),
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
                NormalizeUtils.normalizeNullable(request.description()),
                NormalizeUtils.normalizeNullable(request.releaseNotes()),
                PLUGINS_DIR + "/" + pluginId + "/" + PLUGIN_INDEX_FILE
        );
        List<RepositoryCatalogTypes.RepositoryPluginIndexEntry> entries =
                RepositoryIndexUtils.upsertSorted(current.safePlugins(), next, RepositoryCatalogTypes.RepositoryPluginIndexEntry::id);
        writeJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryIndexUtils.withPlugins(current, repository, entries));
    }

    void commitAndPush(RepositoryDefinition repository, String toolId, String version, String releaseNotes) {
        gitOps.commitAndPush(resolveRepositoryRoot(repository), repository, toolId, version, releaseNotes);
    }

    Map<String, Object> readSchema(String repositoryId, String schemaPath) {
        if (NormalizeUtils.isBlank(schemaPath)) {
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
                .filter(script -> script.getScope() == ScriptScope.DEVELOPMENT
                        && repositoryId.equals(script.getRepositoryId())
                        && toolId.equals(script.getRepositoryToolId()))
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
        RepositoryCatalogTypes.DevelopmentSyncState syncState = DevelopmentSyncService.resolveDevelopmentSyncState(developmentScript, localDigest, state);
        return new DevelopmentInfo(
                DevelopmentSyncService.isLocalChanged(developmentScript, localDigest),
                DevelopmentSyncService.isRemoteChanged(developmentScript, state),
                syncState.name()
        );
    }

    private RepositoryCatalogTypes.RepositoryToolDescriptor toDescriptorWithoutDevelopment(RepositoryDefinition repository, RepositoryCatalogTypes.ToolFile tool, String toolPath) {
        String installedScriptId = repository.getId() + "." + tool.id();
        RepositoryToolInstallation installation = repos.repositoryToolInstallationRepository().findByToolId(installedScriptId).orElse(null);
        boolean installed = installation != null;
        return new RepositoryCatalogTypes.RepositoryToolDescriptor(
                repository.getId(), tool.id(), installedScriptId,
                tool.name(), tool.version(), tool.description(), tool.releaseNotes(), tool.owner(),
                NormalizeUtils.nullSafeList(tool.tags()),
                tool.type(), ScriptPackaging.fromNullableName(tool.packaging()).name(), tool.sourcePath(),
                resolveRelative(toolPath, tool.pythonRequirementsPath()),
                resolveRelative(toolPath, tool.inputSchemaPath()),
                resolveRelative(toolPath, tool.outputSchemaPath()),
                resolveRelative(toolPath, tool.configTemplatePath()),
                resolveRelative(toolPath, tool.scheduleTemplatePath()),
                tool.digest(), tool.riskLevel(),
                NormalizeUtils.nullSafeList(tool.scriptDependencies()), NormalizeUtils.nullSafeList(tool.pluginDependencies()),
                installed,
                installed ? installation.getVersion() : null,
                installed && !Objects.equals(installation.getVersion(), tool.version()),
                isTrusted(repository),
                resolveUsage(repository),
                null, false, false, null
        );
    }

    private RepositoryCatalogTypes.CapabilityPackageDescriptor toCapabilityPackageDescriptor(RepositoryDefinition repository,
                                                                      RepositoryCatalogTypes.CapabilityPackageManifestFile manifest,
                                                                      String manifestPath) {
        String packageId = NormalizeUtils.normalize(manifest.packageId(), "能力包 ID 不能为空");
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
                NormalizeUtils.nullSafeList(manifest.tags()),
                manifest.riskLevel(),
                NormalizeUtils.nullSafeList(manifest.entries()),
                manifestPath,
                manifest.latestReleasePath(),
                installation != null,
                installation == null ? null : installation.getVersion(),
                installation != null && !Objects.equals(installation.getVersion(), manifest.latestVersion()),
                isTrusted(repository),
                resolveUsage(repository)
        );
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
                NormalizeUtils.nullSafeList(plugin.tags()),
                plugin.artifact(),
                plugin.riskLevel(),
                registration != null,
                registration == null ? null : registration.getVersion(),
                registration != null && !Objects.equals(registration.getVersion(), plugin.version()),
                isTrusted(repository),
                dependentToolCount(plugin.pluginId())
        );
    }

    private int dependentToolCount(String pluginId) {
        return (int) repos.scriptRepository().findAll().stream()
                .filter(script -> script.getPluginDependencies().stream()
                        .anyMatch(dep -> pluginId.equals(dep.getPluginId())))
                .count();
    }


    void ensureLocalDirRepository(RepositoryDefinition repository) {
        definitionService.ensureLocalDirRepository(repository);
    }

    RepositoryCatalogTypes.RepositoryIndexFile readRepositoryIndex(RepositoryDefinition repository) {
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            return httpReader.readHttpJson(httpReader.joinHttpPath(repository.getUrl(), REPOSITORY_INDEX_FILE), RepositoryCatalogTypes.RepositoryIndexFile.class);
        }
        Path root = resolveRepositoryRoot(repository);
        if (REPO_TYPE_LOCAL_DIR.equals(repository.getType())) {
            ensureLocalDirRepository(repository);
        }
        if (REPO_TYPE_GIT.equals(repository.getType())) {
            if (Files.notExists(root)) {
                gitOps.syncGitRepository(repository, root);
            }
            RepositoryWorkspaceHelper.ensureRepositoryWorkspace(root, repository, jsonCodec);
        }
        return readJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryCatalogTypes.RepositoryIndexFile.class);
    }

    private <T> T readRepositoryJsonFile(RepositoryDefinition repository, String relativePath, Class<T> type) {
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            return httpReader.readHttpJson(httpReader.joinHttpPath(repository.getUrl(), relativePath), type);
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

    String readRepositoryFile(RepositoryDefinition repository, Path path) {
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            return httpReader.readHttpText(httpReader.joinHttpPath(repository.getUrl(), path.toString().replace('\\', '/')));
        }
        try {
            return Files.readString(safeResolveRepositoryPath(resolveRepositoryRoot(repository), path.toString()), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new IllegalStateException("读取仓库文件失败: " + path, exception);
        }
    }

    private <T> List<T> readOptionalFile(RepositoryDefinition repository, RelativeRepositoryPath path, Class<T> elementType) {
        if (path == null || NormalizeUtils.isBlank(path.value())) {
            return List.of();
        }
        String raw = readRepositoryFile(repository, Path.of(path.value()));
        return jsonCodec.readList(raw, elementType);
    }

    Path resolveRepositoryRoot(RepositoryDefinition repository) {
        return definitionService.resolveRepositoryRoot(repository);
    }

    private static String resolveUsage(RepositoryDefinition repository) {
        return NormalizeUtils.normalizeOrDefault(repository.getUsage(), REPO_USAGE_DISTRIBUTION);
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
        Path normalizedRoot = NormalizeUtils.normalizePath(root);
        Path target = normalizedRoot.resolve(parsed).normalize();
        if (!target.startsWith(normalizedRoot)) {
            throw new IllegalArgumentException(context + "越界访问被拒绝: " + relativePath);
        }
        return target;
    }

    <T> T readJson(Path path, Class<T> type) {
        try (InputStream stream = Files.newInputStream(path)) {
            String raw = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
            RepositoryWorkspaceHelper.assertLatestRepositoryMetadata(raw, type, path.toString());
            return jsonCodec.read(raw, type);
        } catch (IOException exception) {
            throw new IllegalStateException("读取仓库文件失败: " + path, exception);
        }
    }


    void writeJson(Path path, Object value) {
        try {
            Files.createDirectories(path.getParent());
            Files.writeString(path, jsonCodec.write(value), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new IllegalStateException("写入 JSON 文件失败: " + path, exception);
        }
    }

    private <T> List<T> listAllFromEnabledRepositories(Function<String, List<T>> lister, Comparator<T> comparator) {
        return listRepositories().stream()
                .filter(RepositoryDefinition::isEnabled)
                .flatMap(repo -> lister.apply(repo.getId()).stream())
                .sorted(comparator)
                .toList();
    }

    private static <E> E findEntryById(List<E> entries, String id, Function<E, String> idExtractor, String label) {
        return entries.stream()
                .filter(item -> id.equals(idExtractor.apply(item)))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(label + "不存在: " + id));
    }


    RepositoryCatalogTypes.RepositoryIndexFile readRepositoryIndexFile(Path root, RepositoryDefinition repository) {
        return Files.exists(root.resolve(REPOSITORY_INDEX_FILE))
                ? readJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryCatalogTypes.RepositoryIndexFile.class)
                : RepositoryWorkspaceHelper.emptyRepositoryIndex(repository);
    }

    RelativeRepositoryPath parentDirectoryPath(String filePath) {
        return new RelativeRepositoryPath(Path.of(filePath).getParent().toString().replace('\\', '/'));
    }
}
