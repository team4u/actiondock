package org.team4u.actiondock.repository;

import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.AiDependency;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.WebhookDefinition;
import org.team4u.actiondock.domain.model.WebhookScope;
import org.team4u.actiondock.domain.model.WebhookResponsePayload;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.CapabilityPackageInstallation;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.RepositoryLocalAssetMode;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.port.ExecutionPresetRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.CapabilityPackageInstallationRepository;
import org.team4u.actiondock.domain.port.ManagedSkillRepository;
import org.team4u.actiondock.domain.port.PlaybookRepository;
import org.team4u.actiondock.domain.port.RepositoryDefinitionRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.skill.SkillArchiveManager;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;
import org.team4u.actiondock.common.NormalizeUtils;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.stream.Stream;

/**
 * 仓库发现、安装、更新和发布服务。
 *
 * @author jay.wu
 */
public class RepositoryCatalogService {
    private static final System.Logger LOGGER = System.getLogger(RepositoryCatalogService.class.getName());
    private static final String CAPABILITY_PACKAGE_MANIFEST_FILE = "package.json";

    public record ProjectRepositoryResolution(
            String repositoryId,
            String type,
            String purpose,
            String root,
            String entryPath,
            boolean enabled,
            boolean exists,
            String content
    ) {
    }

    /**
     * 仓库接口分组，将所有仓储端口聚合为一个上下文。
     */
    public record Repositories(
            RepositoryDefinitionRepository repositoryDefinitionRepository,
            CapabilityPackageInstallationRepository capabilityPackageInstallationRepository,
            ManagedSkillRepository managedSkillRepository,
            ScriptRepository scriptRepository,
            ScriptScheduleRepository scriptScheduleRepository,
            ExecutionPresetRepository executionPresetRepository,
            ConfigValueRepository configValueRepository,
            org.team4u.actiondock.domain.port.WebhookRepository webhookRepository,
            org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository repositoryLocalAssetRepository,
            AiModelProfileRepository aiModelProfileRepository,
            AiAgentProfileRepository aiAgentProfileRepository,
            AiToolsetRepository aiToolsetRepository,
            PlaybookRepository playbookRepository
    ) {
        public Repositories(RepositoryDefinitionRepository repositoryDefinitionRepository,
                            CapabilityPackageInstallationRepository capabilityPackageInstallationRepository,
                            ManagedSkillRepository managedSkillRepository,
                            ScriptRepository scriptRepository,
                            ScriptScheduleRepository scriptScheduleRepository,
                            ExecutionPresetRepository executionPresetRepository,
                            ConfigValueRepository configValueRepository,
                            org.team4u.actiondock.domain.port.WebhookRepository webhookRepository,
                            org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository repositoryLocalAssetRepository,
                            AiModelProfileRepository aiModelProfileRepository,
                            AiAgentProfileRepository aiAgentProfileRepository,
                            AiToolsetRepository aiToolsetRepository) {
            this(
                    repositoryDefinitionRepository,
                    capabilityPackageInstallationRepository,
                    managedSkillRepository,
                    scriptRepository,
                    scriptScheduleRepository,
                    executionPresetRepository,
                    configValueRepository,
                    webhookRepository,
                    repositoryLocalAssetRepository,
                    aiModelProfileRepository,
                    aiAgentProfileRepository,
                    aiToolsetRepository,
                    emptyPlaybookRepository()
            );
        }
    }

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
    private final Map<String, RepositoryCatalogTypes.RepositoryIndexFile> repositoryCache = new ConcurrentHashMap<>();
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
        ConfigValueApplicationService resolvedConfigValueService = services.configValueApplicationService() == null
                ? ConfigValueApplicationService.disabled()
                : services.configValueApplicationService();
        PluginRuntimeService resolvedPluginRuntimeService = services.pluginRuntimeService() == null ? PluginRuntimeService.disabled() : services.pluginRuntimeService();
        this.services = new ApplicationServices(
                services.scriptApplicationService(),
                resolvedConfigValueService,
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
        this.definitionService = new RepositoryDefinitionService(repos.repositoryDefinitionRepository(), jsonCodec, repositoriesRoot, resolvedConfigValueService);
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

    public List<RepositoryDefinition> listRepositories(String purpose) {
        return NormalizeUtils.isBlank(purpose)
                ? listRepositories()
                : definitionService.listRepositoriesByPurpose(purpose);
    }

    public List<RepositoryDefinition> listEnabledDiscoveryRepositories() {
        return definitionService.listRepositories().stream()
                .filter(this::isDiscoveryRepository)
                .toList();
    }

    public List<RepositoryDefinition> listEnabledSyncRepositories() {
        return definitionService.listRepositories().stream()
                .filter(item -> item != null && item.isEnabled() && !REPO_TYPE_HTTP.equals(item.getType()))
                .toList();
    }

    public RepositoryDefinition getRepository(String repositoryId) {
        return definitionService.getRepository(repositoryId);
    }

    public Optional<RepositoryDefinition> findRepository(String repositoryId) {
        return repos.repositoryDefinitionRepository().findById(repositoryId);
    }

    public RepositoryDefinition saveRepository(RepositoryDefinition definition) {
        RepositoryDefinition saved = definitionService.saveRepository(definition);
        refreshRepositoryCache(saved);
        return saved;
    }

    public void deleteRepository(String repositoryId) {
        definitionService.deleteRepository(repositoryId);
        repositoryCache.remove(repositoryId);
    }

    public void refreshRepositoryCache() {
        repositoryCache.clear();
        for (RepositoryDefinition repository : listEnabledDiscoveryRepositories()) {
            refreshRepositoryCache(repository);
        }
    }

    public void refreshRepositoryCache(String repositoryId) {
        refreshRepositoryCache(getRepository(repositoryId));
    }

    public void refreshRepositoryCache(RepositoryDefinition repository) {
        if (!isDiscoveryRepository(repository)) {
            if (repository != null) {
                repositoryCache.remove(repository.getId());
            }
            return;
        }
        try {
            repositoryCache.put(repository.getId(), scanRepositoryIndex(repository));
        } catch (RuntimeException exception) {
            repositoryCache.remove(repository.getId());
            LOGGER.log(System.Logger.Level.WARNING, "刷新仓库缓存失败: " + repository.getId(), exception);
        }
    }

    public RepositoryDefinition syncRepository(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        if (REPO_PURPOSE_PROJECT.equalsIgnoreCase(repository.getPurpose())) {
            switch (repository.getType()) {
                case REPO_TYPE_GIT -> gitOps.syncGitRepository(repository, resolveRepositoryRoot(repository), resolveRepositoryUrl(repository));
                case REPO_TYPE_LOCAL_DIR -> {
                    Path root = resolveRepositoryRoot(repository);
                    if (!Files.isDirectory(root)) {
                        throw new IllegalArgumentException("项目目录不存在: " + root);
                    }
                }
                default -> throw new IllegalArgumentException("项目仓库类型仅支持 GIT / LOCAL_DIR");
            }
            ensureProjectEntryFile(repository, resolveRepositoryRoot(repository));
            repository.setLastSyncedAt(LocalDateTime.now()).setUpdatedAt(LocalDateTime.now());
            return repos.repositoryDefinitionRepository().save(repository);
        }
        switch (repository.getType()) {
            case REPO_TYPE_GIT -> {
                Path root = resolveRepositoryRoot(repository);
                gitOps.syncGitRepository(repository, root, resolveRepositoryUrl(repository));
                RepositoryWorkspaceHelper.ensureRepositoryWorkspace(root, repository, jsonCodec);
            }
            case REPO_TYPE_LOCAL_DIR -> ensureLocalDirRepository(repository);
            default -> {
            }
        }
        repository.setLastSyncedAt(LocalDateTime.now()).setUpdatedAt(LocalDateTime.now());
        RepositoryDefinition saved = repos.repositoryDefinitionRepository().save(repository);
        refreshRepositoryCache(saved);
        return saved;
    }

    public ProjectRepositoryResolution resolveProjectRepository(String repositoryId) {
        RepositoryDefinition repository = findProjectRepository(repositoryId);
        Path root = resolveRepositoryRoot(repository);
        boolean exists = Files.exists(root);
        if (!exists) {
            if (REPO_TYPE_GIT.equals(repository.getType())) {
                throw new IllegalArgumentException("项目仓库尚未同步，请先同步仓库: " + repository.getId());
            }
            throw new IllegalArgumentException("项目仓库目录不存在: " + repository.getId());
        }
        if (!Files.isDirectory(root)) {
            throw new IllegalArgumentException("项目仓库根路径必须是目录: " + repository.getId());
        }
        Path entry = safeResolveProjectEntryPath(root);
        if (!Files.exists(entry)) {
            throw new IllegalArgumentException("项目知识入口不存在，请重新同步仓库: " + repository.getId());
        }
        if (!Files.isRegularFile(entry)) {
            throw new IllegalArgumentException("项目知识入口必须是文件: " + repository.getId());
        }
        try {
            return new ProjectRepositoryResolution(
                    repository.getId(),
                    repository.getType(),
                    repository.getPurpose(),
                    root.toString(),
                    DEFAULT_PROJECT_ENTRY_PATH,
                    repository.isEnabled(),
                    exists,
                    Files.readString(entry, StandardCharsets.UTF_8)
            );
        } catch (IOException exception) {
            throw new IllegalStateException("读取项目知识入口失败: " + entry, exception);
        }
    }

    public List<RepositoryCatalogTypes.RepositoryProjectFileNode> listProjectRepositoryFiles(String repositoryId, String relativePath) {
        RepositoryDefinition repository = findProjectRepository(repositoryId);
        Path root = resolveRepositoryRoot(repository);
        ensureProjectRepositoryReadable(repository, root);
        Path directory = NormalizeUtils.isBlank(relativePath) ? root : safeResolveRepositoryPath(root, relativePath);
        if (!Files.exists(directory)) {
            throw new IllegalArgumentException("项目仓库路径不存在: " + relativePath);
        }
        if (!Files.isDirectory(directory)) {
            throw new IllegalArgumentException("项目仓库路径不是目录: " + relativePath);
        }
        return RepositoryProjectFileSupport.buildFileTree(root, directory);
    }

    public RepositoryCatalogTypes.RepositoryProjectFilePreview previewProjectRepositoryFile(String repositoryId, String relativePath) {
        RepositoryDefinition repository = findProjectRepository(repositoryId);
        Path root = resolveRepositoryRoot(repository);
        ensureProjectRepositoryReadable(repository, root);
        Path target = safeResolveRepositoryPath(root, NormalizeUtils.normalize(relativePath, "path 不能为空"));
        if (!Files.exists(target)) {
            throw new IllegalArgumentException("项目仓库文件不存在: " + relativePath);
        }
        return RepositoryProjectFileSupport.buildPreview(root, target);
    }

    public List<RepositoryCatalogTypes.RepositoryScriptDescriptor> listAllRepositoryScripts() {
        return listAllFromEnabledRepositories(
                this::listRepositoryScripts,
                Comparator.comparing(RepositoryCatalogTypes.RepositoryScriptDescriptor::repositoryId)
                        .thenComparing(RepositoryCatalogTypes.RepositoryScriptDescriptor::scriptId));
    }

    public List<RepositoryCatalogTypes.RepositoryWebhookDescriptor> listAllRepositoryWebhooks() {
        return listAllFromEnabledRepositories(
                this::listRepositoryWebhooks,
                Comparator.comparing(RepositoryCatalogTypes.RepositoryWebhookDescriptor::repositoryId)
                        .thenComparing(RepositoryCatalogTypes.RepositoryWebhookDescriptor::webhookId));
    }

    public List<RepositoryCatalogTypes.RepositoryPlaybookDescriptor> listAllRepositoryPlaybooks() {
        return listAllFromEnabledRepositories(
                this::listRepositoryPlaybooks,
                Comparator.comparing(RepositoryCatalogTypes.RepositoryPlaybookDescriptor::repositoryId)
                        .thenComparing(RepositoryCatalogTypes.RepositoryPlaybookDescriptor::playbookId));
    }

    public List<RepositoryCatalogTypes.RepositoryScriptDescriptor> listRepositoryScripts(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        return index.safeScripts().stream()
                .map(entry -> {
                    String scriptPath = entry.scriptPath();
                    return toDescriptor(repository, readToolFile(repository, scriptPath), scriptPath);
                })
                .sorted(Comparator.comparing(RepositoryCatalogTypes.RepositoryScriptDescriptor::scriptId))
                .toList();
    }

    public List<RepositoryCatalogTypes.RepositoryWebhookDescriptor> listRepositoryWebhooks(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        return index.safeWebhooks().stream()
                .map(entry -> toWebhookDescriptor(repository, readWebhookFile(repository, entry.webhookPath()), entry.webhookPath()))
                .sorted(Comparator.comparing(RepositoryCatalogTypes.RepositoryWebhookDescriptor::webhookId))
                .toList();
    }

    public List<RepositoryCatalogTypes.RepositoryPlaybookDescriptor> listRepositoryPlaybooks(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        return index.safePlaybooks().stream()
                .map(entry -> toPlaybookDescriptor(repository, readPlaybookFile(repository, entry.playbookPath()), entry.playbookPath()))
                .sorted(Comparator.comparing(RepositoryCatalogTypes.RepositoryPlaybookDescriptor::playbookId))
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

    public RepositoryCatalogTypes.RepositoryScriptDetail getRepositoryScript(String repositoryId, String toolId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositoryCatalogTypes.RepositoryIndexEntry entry = findEntryById(
                index.safeScripts(), toolId, RepositoryCatalogTypes.RepositoryIndexEntry::id, "仓库工具");
        String scriptPath = entry.scriptPath();
        RepositoryCatalogTypes.ToolFile tool = readToolFile(repository, scriptPath);
        List<RepositoryCatalogTypes.ConfigTemplateItem> configTemplate = readOptionalFile(
                repository,
                parentDirectoryPath(scriptPath).resolveNullable(tool.configTemplatePath()),
                RepositoryCatalogTypes.ConfigTemplateItem.class
        );
        List<RepositoryCatalogTypes.ScheduleTemplateItem> scheduleTemplate = readOptionalFile(
                repository,
                parentDirectoryPath(scriptPath).resolveNullable(tool.scheduleTemplatePath()),
                RepositoryCatalogTypes.ScheduleTemplateItem.class
        );
        String source = readRepositoryFile(repository, parentDirectoryPath(scriptPath).resolve(tool.sourcePath()));
        String pythonRequirements = NormalizeUtils.isBlank(tool.pythonRequirementsPath())
                ? null
                : readRepositoryFile(repository, parentDirectoryPath(scriptPath).resolve(tool.pythonRequirementsPath()));
        return new RepositoryCatalogTypes.RepositoryScriptDetail(toDescriptor(repository, tool, scriptPath), source, pythonRequirements, configTemplate, scheduleTemplate);
    }

    public RepositoryCatalogTypes.RepositoryWebhookDetail getRepositoryWebhook(String repositoryId, String webhookId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositoryCatalogTypes.RepositoryWebhookIndexEntry entry = findEntryById(
                index.safeWebhooks(), webhookId, RepositoryCatalogTypes.RepositoryWebhookIndexEntry::id, "仓库 Webhook");
        RepositoryCatalogTypes.WebhookFile webhook = readWebhookFile(repository, entry.webhookPath());
        List<RepositoryCatalogTypes.ConfigTemplateItem> configTemplate = readOptionalFile(
                repository,
                parentDirectoryPath(entry.webhookPath()).resolveNullable(webhook.configTemplatePath()),
                RepositoryCatalogTypes.ConfigTemplateItem.class
        );
        return new RepositoryCatalogTypes.RepositoryWebhookDetail(
                toWebhookDescriptor(repository, webhook, entry.webhookPath()),
                webhook,
                configTemplate
        );
    }

    public RepositoryCatalogTypes.RepositoryPlaybookDetail getRepositoryPlaybook(String repositoryId, String playbookId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryCatalogTypes.RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositoryCatalogTypes.RepositoryPlaybookIndexEntry entry = findEntryById(
                index.safePlaybooks(), playbookId, RepositoryCatalogTypes.RepositoryPlaybookIndexEntry::id, "仓库任务手册");
        RepositoryCatalogTypes.PlaybookFile playbook = readPlaybookFile(repository, entry.playbookPath());
        return new RepositoryCatalogTypes.RepositoryPlaybookDetail(
                toPlaybookDescriptor(repository, playbook, entry.playbookPath()),
                playbook
        );
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
        RepositoryCatalogTypes.RepositoryPluginDescriptor descriptor = pluginRepositoryPublisher.publish(repositoryId, request);
        refreshRepositoryCache(repositoryId);
        return descriptor;
    }

    public RepositoryCatalogTypes.RepositorySkillDescriptor publishSkillArchive(String repositoryId,
                                                         String version,
                                                         String releaseNotes,
                                                         String fileName,
                                                         byte[] content) {
        RepositoryCatalogTypes.RepositorySkillDescriptor descriptor = skillPublisher.publish(repositoryId, version, releaseNotes, fileName, content);
        refreshRepositoryCache(repositoryId);
        return descriptor;
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
        return new WritableRepositorySession(this, repository, root, readRepositoryIndex(repository));
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
        deleteAllByIds(installation.getPlaybookIds(), repos.playbookRepository()::deleteById);
    }

    private static void deleteAllByIds(List<String> ids, java.util.function.Consumer<String> deleter) {
        for (String id : ids) {
            deleter.accept(id);
        }
    }



    private static PlaybookRepository emptyPlaybookRepository() {
        return new PlaybookRepository() {
            @Override
            public Playbook save(Playbook playbook) {
                return playbook;
            }

            @Override
            public Optional<Playbook> findById(String id) {
                return Optional.empty();
            }

            @Override
            public List<Playbook> findAll() {
                return List.of();
            }

            @Override
            public void deleteById(String id) {
            }
        };
    }

    RepositoryCatalogTypes.ToolSourceState resolveToolSourceState(RepositoryDefinition repository, RepositoryCatalogTypes.RepositoryScriptDetail detail) {
        String toolId = detail.descriptor().scriptId();
        String toolPath = readRepositoryIndex(repository).safeScripts().stream()
                .filter(item -> toolId.equals(item.id()))
                .findFirst()
                .map(RepositoryCatalogTypes.RepositoryIndexEntry::scriptPath)
                .orElseThrow(() -> new IllegalArgumentException("仓库工具不存在: " + toolId));
        String digest = computeToolDigest(detail);
        String commit = REPO_TYPE_GIT.equals(repository.getType()) ? gitOps.gitHead(resolveRepositoryRoot(repository)) : null;
        return new RepositoryCatalogTypes.ToolSourceState(parentDirectoryPath(toolPath).value(), commit, digest);
    }

    RepositoryCatalogTypes.ToolSourceState resolveWebhookState(RepositoryDefinition repository, RepositoryCatalogTypes.RepositoryWebhookDetail detail) {
        String webhookId = detail.descriptor().webhookId();
        String webhookPath = readRepositoryIndex(repository).safeWebhooks().stream()
                .filter(item -> webhookId.equals(item.id()))
                .findFirst()
                .map(RepositoryCatalogTypes.RepositoryWebhookIndexEntry::webhookPath)
                .orElseThrow(() -> new IllegalArgumentException("仓库 Webhook不存在: " + webhookId));
        String digest = computeWebhookDigest(detail);
        String commit = REPO_TYPE_GIT.equals(repository.getType()) ? gitOps.gitHead(resolveRepositoryRoot(repository)) : null;
        return new RepositoryCatalogTypes.ToolSourceState(parentDirectoryPath(webhookPath).value(), commit, digest);
    }

    private String computeToolDigest(RepositoryCatalogTypes.RepositoryScriptDetail detail) {
        RepositoryCatalogTypes.RepositoryScriptDescriptor d = detail.descriptor();
        LinkedHashMap<String, Object> values = new LinkedHashMap<>();
        values.put("scriptId", d.scriptId());
        values.put("displayName", d.displayName());
        values.put("version", d.version());
        values.put("type", d.type());
        values.put("packaging", d.packaging());
        values.put("description", d.description());
        values.put("owner", d.owner());
        values.put("tags", d.tags());
        values.put("scriptDependencies", d.scriptDependencies());
        values.put("pluginDependencies", d.pluginDependencies());
        values.put("source", detail.source());
        values.put("pythonRequirements", detail.pythonRequirements());
        values.put("inputSchema", readSchema(d.repositoryId(), d.inputSchemaPath()));
        values.put("outputSchema", readSchema(d.repositoryId(), d.outputSchemaPath()));
        return computeDigest(values);
    }

    String computeWebhookLocalDigest(WebhookDefinition webhook) {
        LinkedHashMap<String, Object> values = new LinkedHashMap<>();
        values.put("webhookId", webhook.getRepositoryWebhookId());
        values.put("displayName", webhook.getName());
        values.put("version", webhook.getRepositoryVersion());
        values.put("description", webhook.getDescription());
        values.put("owner", null);
        values.put("transport", webhook.getTransport());
        values.put("webhookScriptId", webhook.getWebhookScriptId());
        values.put("sampleRequest", webhook.getSampleRequest());
        return computeDigest(values);
    }

    private String computeWebhookDigest(RepositoryCatalogTypes.RepositoryWebhookDetail detail) {
        LinkedHashMap<String, Object> values = new LinkedHashMap<>();
        values.put("webhookId", detail.descriptor().webhookId());
        values.put("displayName", detail.descriptor().displayName());
        values.put("version", detail.descriptor().version());
        values.put("description", detail.descriptor().description());
        values.put("owner", detail.descriptor().owner());
        values.put("transport", detail.webhook().transport());
        values.put("webhookScriptId", detail.webhook().webhookScriptId());
        values.put("sampleRequest", detail.webhook().sampleRequest());
        values.put("scriptDependencies", detail.descriptor().scriptDependencies());
        return computeDigest(values);
    }

    String computeWorkingCopyLocalDigest(ScriptDefinition script) {
        LinkedHashMap<String, Object> values = new LinkedHashMap<>();
        values.put("scriptId", script.getRepositoryScriptId());
        values.put("displayName", script.getName());
        values.put("version", script.getRepositoryVersion());
        values.put("type", script.getType() == null ? null : script.getType().name());
        values.put("packaging", script.getPackaging() == null ? null : script.getPackaging().name());
        values.put("description", script.getDescription());
        values.put("owner", script.getOwner());
        values.put("tags", script.getTags());
        values.put("scriptDependencies", script.getScriptDependencies());
        values.put("pluginDependencies", script.getPluginDependencies());
        values.put("source", script.getSource());
        values.put("pythonRequirements", script.getPythonRequirements());
        values.put("inputSchema", script.getInputSchema());
        values.put("outputSchema", script.getOutputSchema());
        return computeDigest(values);
    }

    String computeDigest(Map<String, Object> values) {
        return RepositoryVersionUtils.sha256(jsonCodec.write(values).getBytes(StandardCharsets.UTF_8));
    }

    private String computeDigest(Object... values) {
        return RepositoryVersionUtils.sha256(jsonCodec.write(Arrays.asList(values)).getBytes(StandardCharsets.UTF_8));
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

    void commitAndPush(RepositoryDefinition repository, String toolId, String version, String releaseNotes) {
        gitOps.commitAndPush(resolveRepositoryRoot(repository), repository, toolId, version, releaseNotes);
    }

    Map<String, Object> readSchema(String repositoryId, String schemaPath) {
        if (NormalizeUtils.isBlank(schemaPath)) {
            return Map.of();
        }
        return jsonCodec.readMap(readRepositoryFile(getRepository(repositoryId), Path.of(schemaPath)));
    }

    private RepositoryCatalogTypes.RepositoryScriptDescriptor toDescriptor(RepositoryDefinition repository, RepositoryCatalogTypes.ToolFile tool, String toolPath) {
        RepositoryCatalogTypes.RepositoryScriptDescriptor base = toDescriptorWithoutUpstream(repository, tool, toolPath);
        RepositoryLocalAsset asset = repos.repositoryLocalAssetRepository()
                .findByUpstreamAsset(UpstreamAssetType.SCRIPT, repository.getId(), tool.id())
                .orElse(null);
        if (asset == null) {
            return base;
        }
        if (asset.getMode() == RepositoryLocalAssetMode.TRACKED) {
            UpstreamInfo upstreamInfo = resolveUpstreamInfo(repository, tool, toolPath, asset, base);
            return base.withLocalState(new RepositoryCatalogTypes.RepositoryLocalAssetState(
                    "TRACKED",
                    asset.getLocalAssetId(),
                    asset.getVersion(),
                    tool.version(),
                    upstreamInfo.remoteChanged(),
                    upstreamInfo.syncState(),
                    upstreamInfo.dirty(),
                    upstreamInfo.remoteChanged()
            ));
        }
        return base.withLocalState(new RepositoryCatalogTypes.RepositoryLocalAssetState(
                "LOCKED",
                asset.getLocalAssetId(),
                asset.getVersion(),
                tool.version(),
                !Objects.equals(asset.getVersion(), tool.version()),
                null,
                false,
                false
        ));
    }

    private RepositoryCatalogTypes.RepositoryWebhookDescriptor toWebhookDescriptor(RepositoryDefinition repository,
                                                                                           RepositoryCatalogTypes.WebhookFile webhook,
                                                                                           String webhookPath) {
        RepositoryCatalogTypes.RepositoryWebhookDescriptor base = toWebhookDescriptorWithoutUpstream(repository, webhook, webhookPath);
        RepositoryLocalAsset asset = repos.repositoryLocalAssetRepository()
                .findByUpstreamAsset(UpstreamAssetType.WEBHOOK, repository.getId(), webhook.webhookId())
                .orElse(null);
        if (asset == null) {
            return base;
        }
        if (asset.getMode() == RepositoryLocalAssetMode.TRACKED) {
            UpstreamInfo upstreamInfo = resolveWebhookUpstreamInfo(repository, webhook, webhookPath, asset, base);
            return base.withLocalState(new RepositoryCatalogTypes.RepositoryLocalAssetState(
                    "TRACKED",
                    asset.getLocalAssetId(),
                    asset.getVersion(),
                    webhook.version(),
                    upstreamInfo.remoteChanged(),
                    upstreamInfo.syncState(),
                    upstreamInfo.dirty(),
                    upstreamInfo.remoteChanged()
            ));
        }
        return base.withLocalState(new RepositoryCatalogTypes.RepositoryLocalAssetState(
                "LOCKED",
                asset.getLocalAssetId(),
                asset.getVersion(),
                webhook.version(),
                !Objects.equals(asset.getVersion(), webhook.version()),
                null,
                false,
                false
        ));
    }

    private RepositoryCatalogTypes.RepositoryPlaybookDescriptor toPlaybookDescriptor(RepositoryDefinition repository,
                                                                                    RepositoryCatalogTypes.PlaybookFile playbook,
                                                                                    String playbookPath) {
        RepositoryCatalogTypes.RepositoryPlaybookDescriptor base = toPlaybookDescriptorWithoutLocalState(repository, playbook, playbookPath);
        RepositoryLocalAsset asset = repos.repositoryLocalAssetRepository()
                .findByUpstreamAsset(UpstreamAssetType.PLAYBOOK, repository.getId(), playbook.playbookId())
                .orElse(null);
        if (asset == null) {
            return base;
        }
        return base.withLocalState(new RepositoryCatalogTypes.RepositoryLocalAssetState(
                "LOCKED",
                asset.getLocalAssetId(),
                asset.getVersion(),
                playbook.version(),
                !Objects.equals(asset.getVersion(), playbook.version()),
                null,
                false,
                false
        ));
    }

    private record UpstreamInfo(boolean dirty, boolean remoteChanged, String syncState) {
    }

    private UpstreamInfo resolveUpstreamInfo(RepositoryDefinition repository,
                                             RepositoryCatalogTypes.ToolFile tool,
                                             String toolPath,
                                             RepositoryLocalAsset binding,
                                             RepositoryCatalogTypes.RepositoryScriptDescriptor base) {
        ScriptDefinition workingCopy = repos.scriptRepository().findById(binding.getLocalAssetId()).orElse(null);
        if (workingCopy == null) {
            return new UpstreamInfo(false, true, RepositoryCatalogTypes.UpstreamSyncState.REMOTE_CHANGES.name());
        }
        RepositoryCatalogTypes.ToolSourceState state = resolveToolSourceState(repository, new RepositoryCatalogTypes.RepositoryScriptDetail(
                base,
                readRepositoryFile(repository, parentDirectoryPath(toolPath).resolve(tool.sourcePath())),
                tool.pythonRequirementsPath() == null ? null : readRepositoryFile(repository, parentDirectoryPath(toolPath).resolve(tool.pythonRequirementsPath())),
                List.of(),
                List.of()
        ));
        String localDigest = computeWorkingCopyLocalDigest(workingCopy);
        RepositoryCatalogTypes.UpstreamSyncState syncState = UpstreamSyncService.resolveSyncState(binding, localDigest, state);
        return new UpstreamInfo(
                UpstreamSyncService.isLocalChanged(binding, localDigest),
                UpstreamSyncService.isRemoteChanged(binding, state),
                syncState.name()
        );
    }

    private UpstreamInfo resolveWebhookUpstreamInfo(RepositoryDefinition repository,
                                                        RepositoryCatalogTypes.WebhookFile webhook,
                                                        String webhookPath,
                                                        RepositoryLocalAsset binding,
                                                        RepositoryCatalogTypes.RepositoryWebhookDescriptor base) {
        WebhookDefinition workingCopy = repos.webhookRepository().findById(binding.getLocalAssetId()).orElse(null);
        if (workingCopy == null) {
            return new UpstreamInfo(false, true, RepositoryCatalogTypes.UpstreamSyncState.REMOTE_CHANGES.name());
        }
        RepositoryCatalogTypes.RepositoryWebhookDetail detail = new RepositoryCatalogTypes.RepositoryWebhookDetail(
                base,
                webhook,
                readOptionalFile(repository, parentDirectoryPath(webhookPath).resolveNullable(webhook.configTemplatePath()), RepositoryCatalogTypes.ConfigTemplateItem.class)
        );
        RepositoryCatalogTypes.ToolSourceState state = resolveWebhookState(repository, detail);
        String localDigest = computeWebhookLocalDigest(workingCopy);
        RepositoryCatalogTypes.UpstreamSyncState syncState = UpstreamSyncService.resolveSyncState(binding, localDigest, state);
        return new UpstreamInfo(
                UpstreamSyncService.isLocalChanged(binding, localDigest),
                UpstreamSyncService.isRemoteChanged(binding, state),
                syncState.name()
        );
    }

    private RepositoryCatalogTypes.RepositoryScriptDescriptor toDescriptorWithoutUpstream(RepositoryDefinition repository, RepositoryCatalogTypes.ToolFile tool, String toolPath) {
        return new RepositoryCatalogTypes.RepositoryScriptDescriptor(
                repository.getId(), tool.id(),
                tool.name(), tool.version(), tool.description(), tool.releaseNotes(), tool.owner(),
                NormalizeUtils.nullSafeList(tool.tags()),
                tool.type(), ScriptPackaging.fromNullableName(tool.packaging()).name(), tool.sourcePath(),
                resolveRelativeValue(toolPath, tool.pythonRequirementsPath()),
                resolveRelativeValue(toolPath, tool.inputSchemaPath()),
                resolveRelativeValue(toolPath, tool.outputSchemaPath()),
                resolveRelativeValue(toolPath, tool.configTemplatePath()),
                resolveRelativeValue(toolPath, tool.scheduleTemplatePath()),
                tool.digest(), tool.riskLevel(),
                NormalizeUtils.nullSafeList(tool.scriptDependencies()), NormalizeUtils.nullSafeList(tool.pluginDependencies()),
                isTrusted(repository),
                null
        );
    }

    private RepositoryCatalogTypes.RepositoryWebhookDescriptor toWebhookDescriptorWithoutUpstream(RepositoryDefinition repository,
                                                                                                          RepositoryCatalogTypes.WebhookFile webhook,
                                                                                                          String webhookPath) {
        return new RepositoryCatalogTypes.RepositoryWebhookDescriptor(
                repository.getId(),
                webhook.webhookId(),
                webhook.displayName(),
                webhook.version(),
                webhook.description(),
                webhook.releaseNotes(),
                webhook.owner(),
                NormalizeUtils.nullSafeList(webhook.tags()),
                webhookPath,
                resolveRelativeValue(webhookPath, webhook.configTemplatePath()),
                webhook.digest(),
                NormalizeUtils.nullSafeList(webhook.scriptDependencies()),
                isTrusted(repository),
                null
        );
    }

    private RepositoryCatalogTypes.RepositoryPlaybookDescriptor toPlaybookDescriptorWithoutLocalState(RepositoryDefinition repository,
                                                                                                      RepositoryCatalogTypes.PlaybookFile playbook,
                                                                                                      String playbookPath) {
        return new RepositoryCatalogTypes.RepositoryPlaybookDescriptor(
                repository.getId(),
                playbook.playbookId(),
                playbook.displayName(),
                playbook.version(),
                playbook.description(),
                playbook.releaseNotes(),
                playbook.owner(),
                NormalizeUtils.nullSafeList(playbook.tags()),
                playbook.riskLevel(),
                playbookPath,
                playbook.digest(),
                isTrusted(repository),
                null
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
                isTrusted(repository)
        );
    }

    void assertPackagingConstraints(ScriptDefinition script) {
        if (script.getPackaging() != ScriptPackaging.TOOL) {
            return;
        }
        List<AiDependency> dependencies = Optional.ofNullable(script.getPublishedRevision())
                .map(org.team4u.actiondock.domain.model.PublishedScriptRevision::getAiDependencies)
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
        if (!isDiscoveryRepository(repository)) {
            return RepositoryWorkspaceHelper.emptyRepositoryIndex(repository);
        }
        return repositoryCache.computeIfAbsent(repository.getId(), ignored -> scanRepositoryIndex(repository));
    }

    private RepositoryCatalogTypes.RepositoryIndexFile scanRepositoryIndex(RepositoryDefinition repository) {
        if (repository == null || REPO_TYPE_HTTP.equals(repository.getType())) {
            return RepositoryWorkspaceHelper.emptyRepositoryIndex(repository);
        }
        Path root = resolveRepositoryRoot(repository);
        if (REPO_TYPE_LOCAL_DIR.equals(repository.getType())) {
            ensureLocalDirRepository(repository);
        }
        if (REPO_TYPE_GIT.equals(repository.getType()) && Files.notExists(root)) {
            gitOps.syncGitRepository(repository, root, resolveRepositoryUrl(repository));
            RepositoryWorkspaceHelper.ensureRepositoryWorkspace(root, repository, jsonCodec);
        }
        return new RepositoryCatalogTypes.RepositoryIndexFile(
                RepositoryIndexUtils.DEFAULT_VERSION,
                NormalizeUtils.normalizeNullable(repository.getName()),
                NormalizeUtils.normalizeNullable(repository.getDescription()),
                scanScripts(repository, root),
                scanWebhooks(repository, root),
                scanPlugins(repository, root),
                scanCapabilityPackages(repository, root),
                scanSkills(repository, root),
                scanKnowledge(repository, root),
                scanPlaybooks(repository, root)
        );
    }

    private List<RepositoryCatalogTypes.RepositoryIndexEntry> scanScripts(RepositoryDefinition repository, Path root) {
        return scanFixedDirectory(root, SCRIPTS_DIR, SCRIPT_DESCRIPTOR_FILE).stream()
                .map(path -> readManifest(repository, path, RepositoryCatalogTypes.ToolFile.class)
                        .map(file -> new RepositoryCatalogTypes.RepositoryIndexEntry(
                                file.id(),
                                file.name(),
                                file.version(),
                                file.type(),
                                file.description(),
                                file.releaseNotes(),
                                path))
                        .orElse(null))
                .filter(Objects::nonNull)
                .sorted(Comparator.comparing(RepositoryCatalogTypes.RepositoryIndexEntry::id))
                .toList();
    }

    private List<RepositoryCatalogTypes.RepositoryWebhookIndexEntry> scanWebhooks(RepositoryDefinition repository, Path root) {
        return scanFixedDirectory(root, WEBHOOKS_DIR, WEBHOOK_DESCRIPTOR_FILE).stream()
                .map(path -> readManifest(repository, path, RepositoryCatalogTypes.WebhookFile.class)
                        .map(file -> new RepositoryCatalogTypes.RepositoryWebhookIndexEntry(
                                file.webhookId(),
                                file.displayName(),
                                file.version(),
                                file.description(),
                                file.releaseNotes(),
                                path))
                        .orElse(null))
                .filter(Objects::nonNull)
                .sorted(Comparator.comparing(RepositoryCatalogTypes.RepositoryWebhookIndexEntry::id))
                .toList();
    }

    private List<RepositoryCatalogTypes.RepositoryPluginIndexEntry> scanPlugins(RepositoryDefinition repository, Path root) {
        return scanFixedDirectory(root, PLUGINS_DIR, PLUGIN_INDEX_FILE).stream()
                .map(path -> readManifest(repository, path, RepositoryCatalogTypes.PluginFile.class)
                        .map(file -> new RepositoryCatalogTypes.RepositoryPluginIndexEntry(
                                file.pluginId(),
                                file.name(),
                                file.version(),
                                file.description(),
                                file.releaseNotes(),
                                path))
                        .orElse(null))
                .filter(Objects::nonNull)
                .sorted(Comparator.comparing(RepositoryCatalogTypes.RepositoryPluginIndexEntry::id))
                .toList();
    }

    private List<RepositoryCatalogTypes.CapabilityPackageIndexEntry> scanCapabilityPackages(RepositoryDefinition repository, Path root) {
        return scanFixedDirectory(root, CAPABILITY_PACKAGES_DIR, CAPABILITY_PACKAGE_MANIFEST_FILE).stream()
                .map(path -> readManifest(repository, path, RepositoryCatalogTypes.CapabilityPackageManifestFile.class)
                        .map(file -> new RepositoryCatalogTypes.CapabilityPackageIndexEntry(
                                file.packageId(),
                                file.displayName(),
                                file.latestVersion(),
                                file.description(),
                                file.releaseNotes(),
                                path))
                        .orElse(null))
                .filter(Objects::nonNull)
                .sorted(Comparator.comparing(RepositoryCatalogTypes.CapabilityPackageIndexEntry::id))
                .toList();
    }

    private List<RepositoryCatalogTypes.RepositorySkillIndexEntry> scanSkills(RepositoryDefinition repository, Path root) {
        return scanFixedDirectory(root, SKILLS_DIR, SKILL_MANIFEST_FILE).stream()
                .map(path -> {
                    String manifestPath = parentDirectoryPath(path).resolve(SkillArchiveManager.SKILL_PACKAGE_FILE).toString().replace('\\', '/');
                    return readManifest(repository, manifestPath, RepositoryCatalogTypes.SkillFile.class)
                        .map(file -> new RepositoryCatalogTypes.RepositorySkillIndexEntry(
                                file.skillId(),
                                file.displayName(),
                                file.version(),
                                file.description(),
                                null,
                                manifestPath))
                        .orElse(null);
                })
                .filter(Objects::nonNull)
                .sorted(Comparator.comparing(RepositoryCatalogTypes.RepositorySkillIndexEntry::id))
                .toList();
    }

    private List<RepositoryCatalogTypes.RepositoryKnowledgeIndexEntry> scanKnowledge(RepositoryDefinition repository, Path root) {
        return scanFixedDirectory(root, KNOWLEDGE_DIR, KNOWLEDGE_MANIFEST_FILE).stream()
                .map(path -> readManifest(repository, path, RepositoryCatalogTypes.KnowledgeFile.class)
                        .map(file -> new RepositoryCatalogTypes.RepositoryKnowledgeIndexEntry(
                                file.knowledgeId(),
                                file.displayName(),
                                file.description(),
                                path,
                                file.source(),
                                file.tags()))
                        .orElse(null))
                .filter(Objects::nonNull)
                .sorted(Comparator.comparing(RepositoryCatalogTypes.RepositoryKnowledgeIndexEntry::id))
                .toList();
    }

    private List<RepositoryCatalogTypes.RepositoryPlaybookIndexEntry> scanPlaybooks(RepositoryDefinition repository, Path root) {
        return scanFixedDirectory(root, PLAYBOOKS_DIR, PLAYBOOK_DESCRIPTOR_FILE).stream()
                .map(path -> readManifest(repository, path, RepositoryCatalogTypes.PlaybookFile.class)
                        .map(file -> new RepositoryCatalogTypes.RepositoryPlaybookIndexEntry(
                                file.playbookId(),
                                file.displayName(),
                                file.version(),
                                file.description(),
                                file.releaseNotes(),
                                path))
                        .orElse(null))
                .filter(Objects::nonNull)
                .sorted(Comparator.comparing(RepositoryCatalogTypes.RepositoryPlaybookIndexEntry::id))
                .toList();
    }



    private List<String> scanFixedDirectory(Path root, String directory, String manifestFile) {
        Path base = root.resolve(directory);
        if (!Files.isDirectory(base)) {
            return List.of();
        }
        try (Stream<Path> stream = Files.list(base)) {
            return stream
                    .filter(Files::isDirectory)
                    .map(path -> base.relativize(path.resolve(manifestFile)))
                    .map(path -> directory + "/" + path.toString().replace('\\', '/'))
                    .filter(path -> Files.isRegularFile(safeResolveRepositoryPath(root, path)))
                    .sorted()
                    .toList();
        } catch (IOException exception) {
            LOGGER.log(System.Logger.Level.WARNING, "扫描仓库目录失败: " + base, exception);
            return List.of();
        }
    }

    private <T> Optional<T> readManifest(RepositoryDefinition repository, String relativePath, Class<T> type) {
        try {
            return Optional.of(readRepositoryJsonFile(repository, relativePath, type));
        } catch (RuntimeException exception) {
            LOGGER.log(System.Logger.Level.WARNING, "跳过无效仓库清单: " + repository.getId() + "/" + relativePath, exception);
            return Optional.empty();
        }
    }

    private <T> T readRepositoryJsonFile(RepositoryDefinition repository, String relativePath, Class<T> type) {
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            return httpReader.readHttpJson(httpReader.joinHttpPath(resolveRepositoryUrl(repository), relativePath), type);
        }
        return readJson(safeResolveRepositoryPath(resolveRepositoryRoot(repository), relativePath), type);
    }

    private RepositoryCatalogTypes.ToolFile readToolFile(RepositoryDefinition repository, String toolPath) {
        return readRepositoryJsonFile(repository, toolPath, RepositoryCatalogTypes.ToolFile.class);
    }

    private RepositoryCatalogTypes.WebhookFile readWebhookFile(RepositoryDefinition repository, String webhookPath) {
        return readRepositoryJsonFile(repository, webhookPath, RepositoryCatalogTypes.WebhookFile.class);
    }

    RepositoryCatalogTypes.PluginFile readPluginFile(RepositoryDefinition repository, String pluginPath) {
        return readRepositoryJsonFile(repository, pluginPath, RepositoryCatalogTypes.PluginFile.class);
    }

    RepositoryCatalogTypes.SkillFile readSkillFile(RepositoryDefinition repository, String skillPath) {
        return readRepositoryJsonFile(repository, skillPath, RepositoryCatalogTypes.SkillFile.class);
    }

    RepositoryCatalogTypes.KnowledgeFile readKnowledgeFile(RepositoryDefinition repository, String knowledgePath) {
        return readRepositoryJsonFile(repository, knowledgePath, RepositoryCatalogTypes.KnowledgeFile.class);
    }

    RepositoryCatalogTypes.PlaybookFile readPlaybookFile(RepositoryDefinition repository, String playbookPath) {
        return readRepositoryJsonFile(repository, playbookPath, RepositoryCatalogTypes.PlaybookFile.class);
    }



    private RepositoryCatalogTypes.CapabilityPackageManifestFile readCapabilityPackageManifest(RepositoryDefinition repository, String manifestPath) {
        return readRepositoryJsonFile(repository, manifestPath, RepositoryCatalogTypes.CapabilityPackageManifestFile.class);
    }

    String readRepositoryFile(RepositoryDefinition repository, Path path) {
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            return httpReader.readHttpText(httpReader.joinHttpPath(resolveRepositoryUrl(repository), path.toString().replace('\\', '/')));
        }
        try {
            return Files.readString(safeResolveRepositoryPath(resolveRepositoryRoot(repository), path.toString()), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new IllegalStateException("读取仓库文件失败: " + path, exception);
        }
    }

    <T> List<T> readOptionalFile(RepositoryDefinition repository, RelativeRepositoryPath path, Class<T> elementType) {
        if (path == null || NormalizeUtils.isBlank(path.value())) {
            return List.of();
        }
        String raw = readRepositoryFile(repository, Path.of(path.value()));
        return jsonCodec.readList(raw, elementType);
    }

    Path resolveRepositoryRoot(RepositoryDefinition repository) {
        return definitionService.resolveRepositoryRoot(repository);
    }

    String resolveRepositoryUrl(RepositoryDefinition repository) {
        return definitionService.resolveRepositoryUrl(repository);
    }

    private RepositoryDefinition findProjectRepository(String repositoryId) {
        String normalized = NormalizeUtils.normalize(repositoryId, "repositoryId 不能为空");
        return definitionService.listRepositories().stream()
                .filter(item -> REPO_PURPOSE_PROJECT.equalsIgnoreCase(item.getPurpose()))
                .filter(item -> normalized.equals(item.getId()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("项目仓库不存在: " + normalized));
    }

    private Path safeResolveProjectEntryPath(Path root) {
        return safeResolvePath(root, DEFAULT_PROJECT_ENTRY_PATH, "项目知识入口路径");
    }

    private void ensureProjectRepositoryReadable(RepositoryDefinition repository, Path root) {
        boolean exists = Files.exists(root);
        if (!exists) {
            if (REPO_TYPE_GIT.equals(repository.getType())) {
                throw new IllegalArgumentException("项目仓库尚未同步，请先同步仓库: " + repository.getId());
            }
            throw new IllegalArgumentException("项目仓库目录不存在: " + repository.getId());
        }
        if (!Files.isDirectory(root)) {
            throw new IllegalArgumentException("项目仓库根路径必须是目录: " + repository.getId());
        }
        Path entry = safeResolveProjectEntryPath(root);
        if (!Files.exists(entry)) {
            throw new IllegalArgumentException("项目知识入口不存在，请重新同步仓库: " + repository.getId());
        }
        if (!Files.isRegularFile(entry)) {
            throw new IllegalArgumentException("项目知识入口必须是文件: " + repository.getId());
        }
    }

    private void ensureProjectEntryFile(RepositoryDefinition repository, Path root) {
        Path entry = safeResolveProjectEntryPath(root);
        if (Files.exists(entry)) {
            return;
        }
        String template = repos.configValueRepository()
                .findByKey("system.project-entry-template")
                .map(ConfigValue::getValue)
                .orElse("## 优先阅读\n\n## 关键目录\n");
        String content = services.configValueApplicationService() != null
                ? services.configValueApplicationService().resolveText(template)
                : template;
        try {
            Files.writeString(entry, content, StandardCharsets.UTF_8);
            LOGGER.log(System.Logger.Level.INFO, "已自动创建项目知识入口: " + entry);
        } catch (IOException exception) {
            throw new IllegalStateException("创建项目知识入口失败: " + entry, exception);
        }
    }

    private static boolean isTrusted(RepositoryDefinition repository) {
        return REPO_TRUST_TRUSTED.equalsIgnoreCase(NormalizeUtils.normalizeOrDefault(repository.getTrustLevel(), REPO_TRUST_UNTRUSTED));
    }

    private RelativeRepositoryPath resolveRelative(String baseFilePath, String nestedPath) {
        if (NormalizeUtils.isBlank(nestedPath)) {
            return null;
        }
        return parentDirectoryPath(baseFilePath).resolveNullable(nestedPath);
    }

    private String resolveRelativeValue(String baseFilePath, String nestedPath) {
        RelativeRepositoryPath resolved = resolveRelative(baseFilePath, nestedPath);
        return resolved == null ? null : resolved.value();
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
                .filter(this::isDiscoveryRepository)
                .flatMap(repo -> lister.apply(repo.getId()).stream())
                .sorted(comparator)
                .toList();
    }

    private boolean isDiscoveryRepository(RepositoryDefinition repository) {
        return repository != null
                && repository.isEnabled()
                && REPO_PURPOSE_CAPABILITY.equalsIgnoreCase(repository.getPurpose())
                && !REPO_TYPE_HTTP.equals(repository.getType());
    }

    private static <E> E findEntryById(List<E> entries, String id, Function<E, String> idExtractor, String label) {
        return entries.stream()
                .filter(item -> id.equals(idExtractor.apply(item)))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(label + "不存在: " + id));
    }


    RepositoryCatalogTypes.RepositoryIndexFile readRepositoryIndexFile(Path root, RepositoryDefinition repository) {
        return scanRepositoryIndex(repository);
    }

    RelativeRepositoryPath parentDirectoryPath(String filePath) {
        return new RelativeRepositoryPath(Path.of(filePath).getParent().toString().replace('\\', '/'));
    }
}
