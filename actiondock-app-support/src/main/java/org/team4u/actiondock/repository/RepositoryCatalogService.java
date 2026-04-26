package org.team4u.actiondock.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ConfigPublishMode;
import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.ScriptStatus;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.model.RepositoryToolInstallation;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.RepositoryDefinitionRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.domain.port.RepositoryToolInstallationRepository;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.plugin.PluginView;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 仓库发现、安装、更新和发布服务。
 *
 * @author jay.wu
 */
public class RepositoryCatalogService {
    private static final String REPOSITORY_INDEX_FILE = "actiondock.repository.json";
    private static final ObjectMapper METADATA_OBJECT_MAPPER = new ObjectMapper();
    private static final Pattern GROOVY_PLUGIN_INVOKE_PATTERN = Pattern.compile(
            "plugins\\s*\\.\\s*invoke\\s*\\(\\s*([\"'`])([^\"'`]+)\\1\\s*,\\s*([\"'`])([^\"'`]+)\\3"
    );

    private final RepositoryDefinitionRepository repositoryDefinitionRepository;
    private final RepositoryToolInstallationRepository repositoryToolInstallationRepository;
    private final ScriptRepository scriptRepository;
    private final ScriptScheduleRepository scriptScheduleRepository;
    private final ConfigValueRepository configValueRepository;
    private final ScriptApplicationService scriptApplicationService;
    private final ConfigValueApplicationService configValueApplicationService;
    private final PluginRuntimeService pluginRuntimeService;
    private final JsonCodec jsonCodec;
    private final HttpClient httpClient;
    private final PluginArtifactResolverRegistry pluginArtifactResolverRegistry;
    private final Path repositoriesRoot;

    public RepositoryCatalogService(RepositoryDefinitionRepository repositoryDefinitionRepository,
                                    RepositoryToolInstallationRepository repositoryToolInstallationRepository,
                                    ScriptRepository scriptRepository,
                                    ScriptScheduleRepository scriptScheduleRepository,
                                    ConfigValueRepository configValueRepository,
                                    ScriptApplicationService scriptApplicationService,
                                    ConfigValueApplicationService configValueApplicationService,
                                    PluginRuntimeService pluginRuntimeService,
                                    JsonCodec jsonCodec,
                                    AppProperties properties) {
        this(repositoryDefinitionRepository,
                repositoryToolInstallationRepository,
                scriptRepository,
                scriptScheduleRepository,
                configValueRepository,
                scriptApplicationService,
                configValueApplicationService,
                pluginRuntimeService,
                jsonCodec,
                properties,
                new PluginArtifactResolverRegistry(List.of(new LocalPluginArtifactResolver(), new HttpPluginArtifactResolver())));
    }

    public RepositoryCatalogService(RepositoryDefinitionRepository repositoryDefinitionRepository,
                                    RepositoryToolInstallationRepository repositoryToolInstallationRepository,
                                    ScriptRepository scriptRepository,
                                    ScriptScheduleRepository scriptScheduleRepository,
                                    ConfigValueRepository configValueRepository,
                                    ScriptApplicationService scriptApplicationService,
                                    ConfigValueApplicationService configValueApplicationService,
                                    PluginRuntimeService pluginRuntimeService,
                                    JsonCodec jsonCodec,
                                    AppProperties properties,
                                    PluginArtifactResolverRegistry pluginArtifactResolverRegistry) {
        this.repositoryDefinitionRepository = repositoryDefinitionRepository;
        this.repositoryToolInstallationRepository = repositoryToolInstallationRepository;
        this.scriptRepository = scriptRepository;
        this.scriptScheduleRepository = scriptScheduleRepository;
        this.configValueRepository = configValueRepository;
        this.scriptApplicationService = scriptApplicationService;
        this.configValueApplicationService = configValueApplicationService;
        this.pluginRuntimeService = pluginRuntimeService == null ? PluginRuntimeService.disabled() : pluginRuntimeService;
        this.jsonCodec = jsonCodec;
        this.httpClient = HttpClient.newHttpClient();
        this.pluginArtifactResolverRegistry = pluginArtifactResolverRegistry == null
                ? new PluginArtifactResolverRegistry(List.of(new LocalPluginArtifactResolver(), new HttpPluginArtifactResolver()))
                : pluginArtifactResolverRegistry;
        this.repositoriesRoot = Path.of(properties == null || properties.getHomeDir() == null || properties.getHomeDir().isBlank()
                ? AppProperties.defaultHomeDir()
                : properties.getHomeDir()).resolve("repositories").toAbsolutePath().normalize();
    }

    public List<RepositoryDefinition> listRepositories() {
        return repositoryDefinitionRepository.findAll().stream()
                .sorted(Comparator.comparing(RepositoryDefinition::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();
    }

    public RepositoryDefinition getRepository(String repositoryId) {
        return repositoryDefinitionRepository.findById(repositoryId)
                .orElseThrow(() -> new IllegalArgumentException("仓库不存在: " + repositoryId));
    }

    public RepositoryDefinition saveRepository(RepositoryDefinition definition) {
        RepositoryDefinition target = definition == null ? new RepositoryDefinition() : definition;
        String id = normalize(target.getId(), "仓库 ID 不能为空");
        String type = normalizeOrDefault(target.getType(), "GIT").toUpperCase(Locale.ROOT);
        if (!List.of("GIT", "HTTP", "LOCAL_DIR").contains(type)) {
            throw new IllegalArgumentException("仓库类型仅支持 GIT / HTTP / LOCAL_DIR");
        }
        String trustLevel = normalizeOrDefault(target.getTrustLevel(), "UNTRUSTED").toUpperCase(Locale.ROOT);
        if (!List.of("TRUSTED", "UNTRUSTED").contains(trustLevel)) {
            throw new IllegalArgumentException("trustLevel 仅支持 TRUSTED / UNTRUSTED");
        }
        String usage = normalizeOrDefault(target.getUsage(), "DISTRIBUTION").toUpperCase(Locale.ROOT);
        if (!List.of("DISTRIBUTION", "DEVELOPMENT").contains(usage)) {
            throw new IllegalArgumentException("usage 仅支持 DISTRIBUTION / DEVELOPMENT");
        }
        if ("HTTP".equals(type) && "DEVELOPMENT".equals(usage)) {
            throw new IllegalArgumentException("HTTP 仓库不支持作为开发仓库");
        }

        LocalDateTime now = LocalDateTime.now();
        RepositoryDefinition existing = repositoryDefinitionRepository.findById(id).orElse(null);
        RepositoryDefinition value = new RepositoryDefinition()
                .setId(id)
                .setName(normalize(target.getName(), "仓库名称不能为空"))
                .setType(type)
                .setUrl(normalize(target.getUrl(), "仓库地址不能为空"))
                .setBranch("GIT".equals(type) ? normalizeOrDefault(target.getBranch(), "main") : null)
                .setEnabled(target.isEnabled())
                .setTrustLevel(trustLevel)
                .setUsage(usage)
                .setDescription(normalizeNullable(target.getDescription()))
                .setLastSyncedAt(existing == null ? null : existing.getLastSyncedAt())
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now);
        RepositoryDefinition saved = repositoryDefinitionRepository.save(value);
        if ("LOCAL_DIR".equals(type)) {
            ensureLocalDirRepository(saved);
            saved.setLastSyncedAt(now).setUpdatedAt(now);
            return repositoryDefinitionRepository.save(saved);
        }
        return saved;
    }

    public void deleteRepository(String repositoryId) {
        getRepository(repositoryId);
        repositoryDefinitionRepository.deleteById(repositoryId);
    }

    public RepositoryDefinition syncRepository(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        if ("GIT".equals(repository.getType())) {
            syncGitRepository(repository);
        } else if ("LOCAL_DIR".equals(repository.getType())) {
            ensureLocalDirRepository(repository);
        } else {
            readRepositoryIndex(repository);
        }
        repository.setLastSyncedAt(LocalDateTime.now()).setUpdatedAt(LocalDateTime.now());
        return repositoryDefinitionRepository.save(repository);
    }

    public List<RepositoryToolDescriptor> listAllRepositoryTools() {
        List<RepositoryToolDescriptor> tools = new ArrayList<>();
        for (RepositoryDefinition repository : listRepositories()) {
            if (!repository.isEnabled()) {
                continue;
            }
            tools.addAll(listRepositoryTools(repository.getId()));
        }
        return tools.stream()
                .sorted(Comparator.comparing(RepositoryToolDescriptor::installedScriptId))
                .toList();
    }

    public List<RepositoryToolDescriptor> listRepositoryTools(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryIndexFile index = readRepositoryIndex(repository);
        List<RepositoryToolDescriptor> tools = new ArrayList<>();
        for (RepositoryIndexEntry entry : safeTools(index)) {
            ToolFile tool = readToolFile(repository, entry.toolPath());
            tools.add(toDescriptor(repository, tool, entry.toolPath()));
        }
        return tools.stream()
                .sorted(Comparator.comparing(RepositoryToolDescriptor::installedScriptId))
                .toList();
    }

    public List<RepositoryPluginDescriptor> listAllRepositoryPlugins() {
        List<RepositoryPluginDescriptor> plugins = new ArrayList<>();
        for (RepositoryDefinition repository : listRepositories()) {
            if (!repository.isEnabled()) {
                continue;
            }
            plugins.addAll(listRepositoryPlugins(repository.getId()));
        }
        return plugins.stream()
                .sorted(Comparator.comparing(RepositoryPluginDescriptor::pluginId))
                .toList();
    }

    public List<RepositoryPluginDescriptor> listRepositoryPlugins(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryIndexFile index = readRepositoryIndex(repository);
        List<RepositoryPluginDescriptor> plugins = new ArrayList<>();
        for (RepositoryPluginIndexEntry entry : safePlugins(index)) {
            PluginFile plugin = readPluginFile(repository, entry.pluginPath());
            plugins.add(toPluginDescriptor(repository, plugin, entry.pluginPath()));
        }
        return plugins.stream()
                .sorted(Comparator.comparing(RepositoryPluginDescriptor::pluginId))
                .toList();
    }

    public RepositoryPluginDetail getRepositoryPlugin(String repositoryId, String pluginId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositoryPluginIndexEntry entry = safePlugins(index).stream()
                .filter(item -> pluginId.equals(item.id()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("仓库插件不存在: " + pluginId));
        PluginFile plugin = readPluginFile(repository, entry.pluginPath());
        return new RepositoryPluginDetail(toPluginDescriptor(repository, plugin, entry.pluginPath()), plugin);
    }

    public RepositoryPluginInstallResult installPlugin(String repositoryId, String pluginId, boolean force) {
        return installOrUpdatePlugin(repositoryId, pluginId, false, force);
    }

    public RepositoryPluginInstallResult updatePlugin(String repositoryId, String pluginId, boolean force) {
        return installOrUpdatePlugin(repositoryId, pluginId, true, force);
    }

    public RepositoryToolDetail getRepositoryTool(String repositoryId, String toolId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositoryIndexEntry entry = safeTools(index).stream()
                .filter(item -> toolId.equals(item.id()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("仓库工具不存在: " + toolId));
        ToolFile tool = readToolFile(repository, entry.toolPath());
        List<ConfigTemplateItem> configTemplate = readOptionalFile(
                repository,
                toolDirectoryPath(entry.toolPath()).resolveNullable(tool.configTemplatePath()),
                ConfigTemplateItem.class
        );
        List<ScheduleTemplateItem> scheduleTemplate = readOptionalFile(
                repository,
                toolDirectoryPath(entry.toolPath()).resolveNullable(tool.scheduleTemplatePath()),
                ScheduleTemplateItem.class
        );
        String source = readRepositoryFile(repository, toolDirectoryPath(entry.toolPath()).resolve(tool.sourcePath()));
        return new RepositoryToolDetail(toDescriptor(repository, tool, entry.toolPath()), source, configTemplate, scheduleTemplate);
    }

    public RepositoryToolInstallation installTool(String repositoryId, String toolId, boolean installSchedules) {
        return installTool(repositoryId, toolId, installSchedules, false, false);
    }

    public RepositoryToolInstallation installTool(String repositoryId,
                                                 String toolId,
                                                 boolean installSchedules,
                                                 boolean installPluginDependencies,
                                                 boolean forcePluginUpgrade) {
        return installOrUpdateTool(repositoryId, toolId, installSchedules, false, installPluginDependencies, forcePluginUpgrade);
    }

    public RepositoryToolInstallation updateTool(String repositoryId, String toolId, boolean installSchedules) {
        return updateTool(repositoryId, toolId, installSchedules, false, false);
    }

    public RepositoryToolInstallation updateTool(String repositoryId,
                                                String toolId,
                                                boolean installSchedules,
                                                boolean installPluginDependencies,
                                                boolean forcePluginUpgrade) {
        return installOrUpdateTool(repositoryId, toolId, installSchedules, true, installPluginDependencies, forcePluginUpgrade);
    }

    public ScriptDefinition syncToolForDevelopment(String repositoryId, String toolId, DevelopmentSyncRequest request) {
        RepositoryDefinition repository = getRepository(repositoryId);
        ensureDevelopmentRepository(repository);
        RepositoryToolDetail detail = getRepositoryTool(repositoryId, toolId);
        String scriptId = normalizeOrDefault(request == null ? null : request.scriptId(), detail.descriptor().toolId());
        ScriptDefinition existing = scriptRepository.findById(scriptId).orElse(null);
        if (existing != null && existing.getScope() != ScriptScope.DEVELOPMENT) {
            throw new IllegalArgumentException("脚本 ID 已存在，请指定其他开发脚本 ID: " + scriptId);
        }
        if (existing != null) {
            return pullDevelopmentScript(scriptId, false);
        }
        ToolSourceState state = resolveToolSourceState(repository, detail);
        return saveDevelopmentScript(scriptId, existing, detail, state);
    }

    public DevelopmentStatus getDevelopmentStatus(String scriptId) {
        ScriptDefinition script = scriptApplicationService.get(scriptId);
        ensureDevelopmentScript(script);
        RepositoryDefinition repository = getRepository(script.getRepositoryId());
        RepositoryToolDetail detail = getRepositoryTool(repository.getId(), script.getRepositoryToolId());
        ToolSourceState state = resolveToolSourceState(repository, detail);
        String localDigest = computeDevelopmentLocalDigest(script);
        String syncState = resolveDevelopmentSyncState(script, localDigest, state);
        boolean remoteChanged = isRemoteChanged(script, state);
        boolean dirty = isLocalChanged(script, localDigest);
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
                syncState,
                detail.descriptor().version(),
                script.getSourceSyncedAt()
        );
    }

    public ScriptDefinition pullDevelopmentScript(String scriptId, boolean force) {
        ScriptDefinition script = scriptApplicationService.get(scriptId);
        ensureDevelopmentScript(script);
        RepositoryDefinition repository = getRepository(script.getRepositoryId());
        syncRepository(repository.getId());
        RepositoryToolDetail detail = getRepositoryTool(repository.getId(), script.getRepositoryToolId());
        ToolSourceState state = resolveToolSourceState(repository, detail);
        String localDigest = computeDevelopmentLocalDigest(script);
        String syncState = resolveDevelopmentSyncState(script, localDigest, state);
        if ("SYNCED".equals(syncState)) {
            return script;
        }
        if ("LOCAL_CHANGES".equals(syncState) && !force) {
            return script;
        }
        if ("DIVERGED".equals(syncState) && !force) {
            throw new DevelopmentConflictException(script.getId(), script.getRepositoryId(), script.getRepositoryToolId());
        }
        return saveDevelopmentScript(script.getId(), script, detail, state);
    }

    private boolean isRemoteChanged(ScriptDefinition script, ToolSourceState state) {
        return !Objects.equals(script.getSourceCommit(), state.commit())
                || !Objects.equals(script.getSourceDigest(), state.digest());
    }

    private boolean isLocalChanged(ScriptDefinition script, String localDigest) {
        return !Objects.equals(script.getSourceDigest(), localDigest);
    }

    private String resolveDevelopmentSyncState(ScriptDefinition script, String localDigest, ToolSourceState remoteState) {
        boolean localChanged = isLocalChanged(script, localDigest);
        boolean remoteChanged = isRemoteChanged(script, remoteState);
        if (localChanged && remoteChanged) {
            return "DIVERGED";
        }
        if (localChanged) {
            return "LOCAL_CHANGES";
        }
        if (remoteChanged) {
            return "REMOTE_CHANGES";
        }
        return "SYNCED";
    }

    private void ensureDevelopmentRepository(RepositoryDefinition repository) {
        if (!"DEVELOPMENT".equalsIgnoreCase(repository.getUsage())) {
            throw new IllegalArgumentException("仓库不是开发仓库: " + repository.getId());
        }
        if ("HTTP".equals(repository.getType())) {
            throw new IllegalArgumentException("HTTP 仓库不支持开发同步");
        }
    }

    private void ensureDevelopmentScript(ScriptDefinition script) {
        if (script.getScope() != ScriptScope.DEVELOPMENT) {
            throw new IllegalArgumentException("脚本不是开发仓库脚本: " + script.getId());
        }
        normalize(script.getRepositoryId(), "开发脚本缺少来源仓库");
        normalize(script.getRepositoryToolId(), "开发脚本缺少来源工具");
    }

    private ScriptDefinition saveDevelopmentScript(String scriptId,
                                                   ScriptDefinition existing,
                                                   RepositoryToolDetail detail,
                                                   ToolSourceState state) {
        LocalDateTime now = LocalDateTime.now();
        Map<String, Object> inputSchema = readSchema(detail.descriptor().repositoryId(), detail.descriptor().inputSchemaPath());
        Map<String, Object> outputSchema = readSchema(detail.descriptor().repositoryId(), detail.descriptor().outputSchemaPath());
        ScriptDefinition definition = new ScriptDefinition()
                .setId(scriptId)
                .setName(detail.descriptor().displayName())
                .setType(ScriptType.valueOf(detail.descriptor().type()))
                .setSource(detail.source())
                .setInputSchema(inputSchema)
                .setOutputSchema(outputSchema)
                .setStatus(ScriptStatus.PUBLISHED)
                .setPublishedSnapshot(new PublishedScriptSnapshot()
                        .setName(detail.descriptor().displayName())
                        .setType(ScriptType.valueOf(detail.descriptor().type()))
                        .setSource(detail.source())
                        .setInputSchema(inputSchema)
                        .setOutputSchema(outputSchema))
                .setVersion(existing == null ? 1 : existing.getVersion())
                .setScope(ScriptScope.DEVELOPMENT)
                .setRepositoryId(detail.descriptor().repositoryId())
                .setRepositoryToolId(detail.descriptor().toolId())
                .setRepositoryVersion(detail.descriptor().version())
                .setSourcePath(state.path())
                .setSourceCommit(state.commit())
                .setSourceDigest(state.digest())
                .setSourceSyncedAt(now)
                .setDirty(false)
                .setEditable(true)
                .setOwner(detail.descriptor().owner())
                .setDescription(detail.descriptor().description())
                .setTags(detail.descriptor().tags())
                .setPluginDependencies(detail.descriptor().pluginDependencies())
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now);
        return scriptRepository.save(definition);
    }

    private void assertDevelopmentPublishSafe(ScriptDefinition script, RepositoryDefinition repository) {
        RepositoryToolDetail detail = getRepositoryTool(repository.getId(), script.getRepositoryToolId());
        ToolSourceState state = resolveToolSourceState(repository, detail);
        String syncState = resolveDevelopmentSyncState(script, computeDevelopmentLocalDigest(script), state);
        if ("REMOTE_CHANGES".equals(syncState) || "DIVERGED".equals(syncState)) {
            throw new DevelopmentConflictException(script.getId(), script.getRepositoryId(), script.getRepositoryToolId());
        }
    }

    private void updateDevelopmentSourceMetadata(ScriptDefinition sourceScript,
                                                 RepositoryDefinition repository,
                                                 RepositoryToolDetail detail) {
        ToolSourceState state = resolveToolSourceState(repository, detail);
        ScriptDefinition updated = scriptApplicationService.get(sourceScript.getId())
                .setRepositoryVersion(detail.descriptor().version())
                .setSourcePath(state.path())
                .setSourceCommit(state.commit())
                .setSourceDigest(state.digest())
                .setSourceSyncedAt(LocalDateTime.now())
                .setDirty(false);
        scriptRepository.save(updated);
    }

    public void uninstallTool(String installedScriptId) {
        ScriptDefinition definition = scriptRepository.findById(installedScriptId)
                .orElseThrow(() -> new IllegalArgumentException("已安装工具不存在: " + installedScriptId));
        if (definition.getScope() != ScriptScope.REPOSITORY) {
            throw new IllegalArgumentException("仅支持卸载仓库工具");
        }
        scriptScheduleRepository.findAll().stream()
                .filter(item -> installedScriptId.equals(item.getRepositoryToolId()))
                .map(ScriptSchedule::getId)
                .toList()
                .forEach(scriptScheduleRepository::deleteById);
        scriptRepository.deleteById(installedScriptId);
        repositoryToolInstallationRepository.deleteByToolId(installedScriptId);
    }

    public ScriptDefinition forkTool(String installedScriptId, String newId, String newName) {
        return scriptApplicationService.createFork(installedScriptId, newId, newName);
    }

    public RepositoryToolDescriptor publishTool(String repositoryId, RepositoryPublishRequest request) {
        RepositoryDefinition repository = getRepository(repositoryId);
        if ("HTTP".equals(repository.getType())) {
            throw new IllegalArgumentException("HTTP 仓库暂不支持发布");
        }
        if ("GIT".equals(repository.getType())) {
            syncRepository(repositoryId);
        } else {
            ensureLocalDirRepository(repository);
        }

        ScriptDefinition sourceScript = scriptApplicationService.get(normalize(request.scriptId(), "scriptId 不能为空"));
        if (sourceScript.getScope() == ScriptScope.DEVELOPMENT
                && Objects.equals(sourceScript.getRepositoryId(), repositoryId)
                && !request.force()) {
            assertDevelopmentPublishSafe(sourceScript, repository);
        }
        ScriptDefinition script = scriptApplicationService.getPublished(sourceScript.getId());
        String toolId = normalize(request.toolId(), "toolId 不能为空");
        String version = normalize(request.version(), "version 不能为空");
        Path root = resolveRepositoryRoot(repository);
        RepositoryIndexFile current = readRepositoryIndexFile(root, repository);
        assertToolVersionAvailable(repositoryId, current, toolId, version);
        Path toolDir = root.resolve("tools").resolve(toolId);
        writeToolFiles(toolDir, toolId, script, request);
        updateRepositoryIndex(root, repository, toolId, script, request);

        if ("GIT".equals(repository.getType())) {
            commitAndPush(repository, toolId, version, request.releaseNotes());
        }
        RepositoryToolDetail publishedDetail = getRepositoryTool(repositoryId, toolId);
        if (sourceScript.getScope() == ScriptScope.DEVELOPMENT
                && Objects.equals(sourceScript.getRepositoryId(), repositoryId)
                && Objects.equals(sourceScript.getRepositoryToolId(), toolId)) {
            updateDevelopmentSourceMetadata(sourceScript, repository, publishedDetail);
        }
        return publishedDetail.descriptor();
    }

    public RepositoryPluginDescriptor publishPlugin(String repositoryId, RepositoryPluginPublishRequest request) {
        RepositoryDefinition repository = getRepository(repositoryId);
        if ("HTTP".equals(repository.getType())) {
            throw new IllegalArgumentException("HTTP 仓库暂不支持发布");
        }
        if ("GIT".equals(repository.getType())) {
            syncRepository(repositoryId);
        } else {
            ensureLocalDirRepository(repository);
        }

        String pluginId = normalize(request.pluginId(), "pluginId 不能为空");
        String displayName = normalize(request.displayName(), "displayName 不能为空");
        String version = normalize(request.version(), "version 不能为空");
        Path root = resolveRepositoryRoot(repository);
        PluginArtifactRef artifact = completePluginArtifactRef(pluginId, request.artifact(), repository, root);
        RepositoryIndexFile current = readRepositoryIndexFile(root, repository);
        assertPluginVersionAvailable(repositoryId, current, pluginId, version);
        Path pluginDir = root.resolve("plugins").resolve(pluginId);
        writePluginFiles(pluginDir, pluginId, displayName, artifact, request, version);
        updateRepositoryPluginIndex(root, repository, pluginId, displayName, request, version);

        if ("GIT".equals(repository.getType())) {
            commitAndPush(repository, pluginId, version, request.releaseNotes());
        }
        return getRepositoryPlugin(repositoryId, pluginId).descriptor();
    }

    private RepositoryToolInstallation installOrUpdateTool(String repositoryId,
                                                           String toolId,
                                                           boolean installSchedules,
                                                           boolean updateOnly,
                                                           boolean installPluginDependencies,
                                                           boolean forcePluginUpgrade) {
        RepositoryToolDetail detail = getRepositoryTool(repositoryId, toolId);
        String installedScriptId = detail.descriptor().installedScriptId();
        ScriptDefinition existing = scriptRepository.findById(installedScriptId).orElse(null);
        if (updateOnly && existing == null) {
            throw new IllegalArgumentException("工具尚未安装: " + installedScriptId);
        }
        resolvePluginDependencies(repositoryId, detail.descriptor().pluginDependencies(), installPluginDependencies, forcePluginUpgrade);

        LocalDateTime now = LocalDateTime.now();
        ScriptDefinition definition = new ScriptDefinition()
                .setId(installedScriptId)
                .setName(detail.descriptor().displayName())
                .setType(ScriptType.valueOf(detail.descriptor().type()))
                .setSource(detail.source())
                .setInputSchema(readSchema(repositoryId, detail.descriptor().inputSchemaPath()))
                .setOutputSchema(readSchema(repositoryId, detail.descriptor().outputSchemaPath()))
                .setStatus(ScriptStatus.PUBLISHED)
                .setPublishedSnapshot(new PublishedScriptSnapshot()
                        .setName(detail.descriptor().displayName())
                        .setType(ScriptType.valueOf(detail.descriptor().type()))
                        .setSource(detail.source())
                        .setInputSchema(readSchema(repositoryId, detail.descriptor().inputSchemaPath()))
                        .setOutputSchema(readSchema(repositoryId, detail.descriptor().outputSchemaPath())))
                .setVersion(existing == null ? 1 : (existing.getVersion() == null ? 1 : existing.getVersion() + 1))
                .setScope(ScriptScope.REPOSITORY)
                .setRepositoryId(repositoryId)
                .setRepositoryToolId(detail.descriptor().toolId())
                .setRepositoryVersion(detail.descriptor().version())
                .setEditable(false)
                .setOwner(detail.descriptor().owner())
                .setDescription(detail.descriptor().description())
                .setTags(detail.descriptor().tags())
                .setPluginDependencies(detail.descriptor().pluginDependencies())
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now);
        scriptRepository.save(definition);
        syncConfigTemplates(repositoryId, detail.descriptor().toolId(), detail.configTemplate());
        if (installSchedules) {
            syncScheduleTemplates(definition, detail.scheduleTemplate());
        }

        RepositoryToolInstallation installation = new RepositoryToolInstallation()
                .setToolId(installedScriptId)
                .setRepositoryId(repositoryId)
                .setName(definition.getName())
                .setVersion(detail.descriptor().version())
                .setLatestVersion(detail.descriptor().version())
                .setOwner(definition.getOwner())
                .setDescription(definition.getDescription())
                .setInstalledAt(existing == null ? now : Optional.ofNullable(repositoryToolInstallationRepository.findByToolId(installedScriptId)
                        .map(RepositoryToolInstallation::getInstalledAt)
                        .orElse(null)).orElse(now))
                .setUpdatedAt(now);
        return repositoryToolInstallationRepository.save(installation);
    }

    private ToolSourceState resolveToolSourceState(RepositoryDefinition repository, RepositoryToolDetail detail) {
        String toolPath = findRepositoryToolPath(repository, detail.descriptor().toolId());
        String digest = computeToolDigest(detail);
        String commit = "GIT".equals(repository.getType()) ? gitHead(resolveRepositoryRoot(repository)) : null;
        return new ToolSourceState(toolDirectoryPath(toolPath).value(), commit, digest);
    }

    private String findRepositoryToolPath(RepositoryDefinition repository, String toolId) {
        RepositoryIndexFile index = readRepositoryIndex(repository);
        return safeTools(index).stream()
                .filter(item -> toolId.equals(item.id()))
                .findFirst()
                .map(RepositoryIndexEntry::toolPath)
                .orElseThrow(() -> new IllegalArgumentException("仓库工具不存在: " + toolId));
    }

    private String computeToolDigest(RepositoryToolDetail detail) {
        Map<String, Object> values = new LinkedHashMap<>();
        RepositoryToolDescriptor descriptor = detail.descriptor();
        values.put("toolId", descriptor.toolId());
        values.put("displayName", descriptor.displayName());
        values.put("version", descriptor.version());
        values.put("type", descriptor.type());
        values.put("description", descriptor.description());
        values.put("owner", descriptor.owner());
        values.put("tags", descriptor.tags());
        values.put("pluginDependencies", descriptor.pluginDependencies());
        values.put("source", detail.source());
        values.put("inputSchema", readSchema(descriptor.repositoryId(), descriptor.inputSchemaPath()));
        values.put("outputSchema", readSchema(descriptor.repositoryId(), descriptor.outputSchemaPath()));
        return sha256(jsonCodec.write(values).getBytes(StandardCharsets.UTF_8));
    }

    private String computeDevelopmentLocalDigest(ScriptDefinition script) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("toolId", script.getRepositoryToolId());
        values.put("displayName", script.getName());
        values.put("version", script.getRepositoryVersion());
        values.put("type", script.getType() == null ? null : script.getType().name());
        values.put("description", script.getDescription());
        values.put("owner", script.getOwner());
        values.put("tags", script.getTags());
        values.put("pluginDependencies", script.getPluginDependencies());
        values.put("source", script.getSource());
        values.put("inputSchema", script.getInputSchema());
        values.put("outputSchema", script.getOutputSchema());
        return sha256(jsonCodec.write(values).getBytes(StandardCharsets.UTF_8));
    }

    private RepositoryPluginInstallResult installOrUpdatePlugin(String repositoryId,
                                                               String pluginId,
                                                               boolean updateOnly,
                                                               boolean force) {
        RepositoryPluginDetail detail = getRepositoryPlugin(repositoryId, pluginId);
        RepositoryPluginDescriptor descriptor = detail.descriptor();
        PluginRegistration existing = findPluginRegistration(pluginId).orElse(null);
        if (updateOnly && existing == null) {
            throw new IllegalArgumentException("插件尚未安装: " + pluginId);
        }
        List<RepositoryPluginConflict> conflicts = findPluginConflicts(pluginId, descriptor.version());
        if (!conflicts.isEmpty() && !force) {
            throw new RepositoryPluginConflictException(pluginId, conflicts);
        }

        RepositoryDefinition repository = getRepository(repositoryId);
        PluginArtifactRef artifactRef = validatePluginArtifactRef(detail.plugin().artifact(), true);
        PluginArtifact artifact = pluginArtifactResolverRegistry.resolve(
                artifactRef,
                new PluginArtifactContext(repository, detail, resolveRepositoryRoot(repository))
        );
        verifySha256(pluginId, artifact.content(), artifactRef.sha256());
        verifySize(pluginId, artifact.content(), artifactRef.size());
        PluginView plugin = existing == null
                ? pluginRuntimeService.installFromRepository(
                artifact.fileName(),
                artifact.content(),
                repositoryId,
                pluginId,
                descriptor.version()
        )
                : pluginRuntimeService.upgradeFromRepository(
                pluginId,
                artifact.fileName(),
                artifact.content(),
                repositoryId,
                pluginId,
                descriptor.version()
        );
        return new RepositoryPluginInstallResult(plugin, conflicts);
    }

    private void resolvePluginDependencies(String repositoryId,
                                           List<PluginDependency> dependencies,
                                           boolean installPluginDependencies,
                                           boolean forcePluginUpgrade) {
        for (PluginDependency dependency : dependencies == null ? List.<PluginDependency>of() : dependencies) {
            String pluginId = normalize(dependency.getPluginId(), "插件依赖 pluginId 不能为空");
            PluginRegistration registration = findPluginRegistration(pluginId).orElse(null);
            if (registration != null && versionSatisfies(registration.getVersion(), dependency.getVersionRange())) {
                continue;
            }
            if (!installPluginDependencies) {
                throw new IllegalArgumentException("缺少插件依赖或版本不满足: " + pluginId + " " + normalizeOrDefault(dependency.getVersionRange(), ""));
            }

            RepositoryPluginDescriptor descriptor = findRepositoryPlugin(repositoryId, pluginId)
                    .orElseThrow(() -> new IllegalArgumentException("仓库中缺少插件依赖: " + pluginId));
            if (!versionSatisfies(descriptor.version(), dependency.getVersionRange())) {
                throw new IllegalArgumentException("仓库插件版本不满足工具依赖: " + pluginId + " " + dependency.getVersionRange());
            }
            if (registration == null) {
                installPlugin(repositoryId, pluginId, forcePluginUpgrade);
            } else {
                updatePlugin(repositoryId, pluginId, forcePluginUpgrade);
            }
        }
    }

    private Optional<RepositoryPluginDescriptor> findRepositoryPlugin(String repositoryId, String pluginId) {
        return listRepositoryPlugins(repositoryId).stream()
                .filter(item -> pluginId.equals(item.pluginId()))
                .findFirst();
    }

    private Optional<PluginRegistration> findPluginRegistration(String pluginId) {
        return pluginRuntimeService.list().stream()
                .filter(item -> pluginId.equals(item.getPluginId()))
                .findFirst()
                .map(item -> pluginRuntimeService.getRegistration(pluginId));
    }

    private List<RepositoryPluginConflict> findPluginConflicts(String pluginId, String targetVersion) {
        List<RepositoryPluginConflict> conflicts = new ArrayList<>();
        for (ScriptDefinition script : scriptRepository.findAll()) {
            for (PluginDependency dependency : script.getPluginDependencies()) {
                if (pluginId.equals(dependency.getPluginId()) && !versionSatisfies(targetVersion, dependency.getVersionRange())) {
                    conflicts.add(new RepositoryPluginConflict(
                            script.getId(),
                            script.getName(),
                            dependency.getVersionRange()
                    ));
                }
            }
        }
        return conflicts;
    }

    private boolean versionSatisfies(String version, String range) {
        if (range == null || range.isBlank()) {
            return true;
        }
        if (version == null || version.isBlank()) {
            return false;
        }
        for (String token : range.trim().split("\\s+")) {
            if (token.isBlank()) {
                continue;
            }
            String operator = token.startsWith(">=") || token.startsWith("<=")
                    ? token.substring(0, 2)
                    : token.substring(0, 1);
            String expected = token.substring(operator.length());
            int comparison = compareVersion(version, expected);
            boolean matches = switch (operator) {
                case ">" -> comparison > 0;
                case ">=" -> comparison >= 0;
                case "<" -> comparison < 0;
                case "<=" -> comparison <= 0;
                case "=" -> comparison == 0;
                default -> compareVersion(version, token) == 0;
            };
            if (!matches) {
                return false;
            }
        }
        return true;
    }

    private int compareVersion(String left, String right) {
        String[] leftParts = normalizeVersion(left).split("\\.");
        String[] rightParts = normalizeVersion(right).split("\\.");
        int length = Math.max(leftParts.length, rightParts.length);
        for (int index = 0; index < length; index++) {
            int leftValue = index < leftParts.length ? parseVersionPart(leftParts[index]) : 0;
            int rightValue = index < rightParts.length ? parseVersionPart(rightParts[index]) : 0;
            if (leftValue != rightValue) {
                return Integer.compare(leftValue, rightValue);
            }
        }
        return 0;
    }

    private String normalizeVersion(String version) {
        String normalized = version == null ? "" : version.trim();
        return normalized.startsWith("v") || normalized.startsWith("V") ? normalized.substring(1) : normalized;
    }

    private int parseVersionPart(String value) {
        String digits = value.replaceAll("[^0-9].*$", "");
        if (digits.isBlank()) {
            return 0;
        }
        return Integer.parseInt(digits);
    }

    private void verifySha256(String pluginId, byte[] content, String expected) {
        normalize(expected, "插件 artifact.sha256 不能为空");
        String actual = sha256(content);
        if (!actual.equalsIgnoreCase(expected.trim())) {
            throw new IllegalArgumentException("插件校验失败: " + pluginId);
        }
    }

    private void verifySize(String pluginId, byte[] content, Long expected) {
        if (expected == null) {
            return;
        }
        if (expected < 0) {
            throw new IllegalArgumentException("插件 artifact.size 不能为负数: " + pluginId);
        }
        if (content.length != expected) {
            throw new IllegalArgumentException("插件大小校验失败: " + pluginId);
        }
    }

    private String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("当前 JRE 不支持 SHA-256", exception);
        }
    }

    private void syncConfigTemplates(String repositoryId, String toolId, List<ConfigTemplateItem> templates) {
        for (ConfigTemplateItem template : templates) {
            ConfigValue existing = configValueRepository.findByKey(template.key()).orElse(null);
            String publishMode = (template.secret() || template.defaultValue() == null || template.defaultValue().isBlank())
                    ? ConfigPublishMode.PLACEHOLDER.name()
                    : ConfigPublishMode.INLINE.name();
            if (existing == null) {
                configValueRepository.save(new ConfigValue()
                        .setKey(template.key())
                        .setValue(publishMode.equals(ConfigPublishMode.INLINE.name()) ? template.defaultValue() : "")
                        .setDescription(normalizeNullable(template.label()))
                        .setRepositoryId(repositoryId)
                        .setRepositoryToolId(toolId)
                        .setRepositoryVersion(null)
                        .setPublishMode(publishMode)
                        .setManaged(true)
                        .setOverridden(false)
                        .setCreatedAt(LocalDateTime.now())
                        .setUpdatedAt(LocalDateTime.now()));
                continue;
            }
            boolean sameSource = Objects.equals(existing.getRepositoryId(), repositoryId)
                    && Objects.equals(existing.getRepositoryToolId(), toolId);
            if (sameSource && !existing.isOverridden()) {
                existing.setDescription(normalizeNullable(template.label()))
                        .setPublishMode(publishMode)
                        .setManaged(true)
                        .setValue(publishMode.equals(ConfigPublishMode.INLINE.name()) ? template.defaultValue() : "")
                        .setUpdatedAt(LocalDateTime.now());
                configValueRepository.save(existing);
            }
        }
    }

    private void syncScheduleTemplates(ScriptDefinition definition, List<ScheduleTemplateItem> templates) {
        List<ScriptSchedule> all = scriptScheduleRepository.findAll();
        for (ScheduleTemplateItem template : templates) {
            ScriptSchedule existing = all.stream()
                    .filter(item -> definition.getId().equals(item.getScriptId()))
                    .filter(item -> definition.getRepositoryId().equals(item.getRepositoryId()))
                    .filter(item -> definition.getId().equals(item.getRepositoryToolId()))
                    .filter(item -> item.getName().equals(template.name()))
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
            scriptScheduleRepository.save(schedule);
        }
    }

    private void writeToolFiles(Path toolDir,
                                String toolId,
                                ScriptDefinition script,
                                RepositoryPublishRequest request) {
        try {
            Files.createDirectories(toolDir);
            String sourceFileName = script.getType() == ScriptType.PYTHON ? "source.py" : "source.groovy";
            Files.writeString(toolDir.resolve(sourceFileName), script.getPublishedSnapshot().getSource(), StandardCharsets.UTF_8);
            writeJson(toolDir.resolve("tool.json"), buildToolFile(script, request, sourceFileName));
            writeJson(toolDir.resolve("input.schema.json"), script.getPublishedSnapshot().getInputSchema());
            writeJson(toolDir.resolve("output.schema.json"), script.getPublishedSnapshot().getOutputSchema());

            List<ConfigTemplateItem> configTemplates = buildConfigTemplate(request);
            if (!configTemplates.isEmpty()) {
                writeJson(toolDir.resolve("config.template.json"), configTemplates);
            }
            List<ScheduleTemplateItem> scheduleTemplates = buildScheduleTemplate(request);
            if (!scheduleTemplates.isEmpty()) {
                writeJson(toolDir.resolve("schedules.template.json"), scheduleTemplates);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("写入仓库工具文件失败", exception);
        }
    }

    private void writePluginFiles(Path pluginDir,
                                  String pluginId,
                                  String displayName,
                                  PluginArtifactRef artifact,
                                  RepositoryPluginPublishRequest request,
                                  String version) {
        try {
            Files.createDirectories(pluginDir);
            writeJson(pluginDir.resolve("plugin.json"), new PluginFile(
                    1,
                    pluginId,
                    displayName,
                    version,
                    normalizeNullable(request.description()),
                    normalizeNullable(request.releaseNotes()),
                    normalizeNullable(request.owner()),
                    request.tags() == null ? List.of() : request.tags(),
                    artifact,
                    normalizeNullable(request.riskLevel())
            ));
        } catch (IOException exception) {
            throw new IllegalStateException("写入仓库插件文件失败", exception);
        }
    }

    private ToolFile buildToolFile(ScriptDefinition script,
                                   RepositoryPublishRequest request,
                                   String sourceFileName) {
        return new ToolFile(
                1,
                normalize(request.toolId(), "toolId 不能为空"),
                normalizeOrDefault(request.displayName(), script.getName()),
                normalize(request.version(), "version 不能为空"),
                script.getType().name(),
                normalizeNullable(script.getDescription()),
                normalizeNullable(request.releaseNotes()),
                normalizeNullable(request.owner()),
                request.tags() == null ? List.of() : request.tags(),
                sourceFileName,
                "input.schema.json",
                "output.schema.json",
                request.configItems() == null || request.configItems().isEmpty() ? null : "config.template.json",
                request.scheduleIds() == null || request.scheduleIds().isEmpty() ? null : "schedules.template.json",
                null,
                null,
                resolveToolPluginDependencies(script)
        );
    }

    private List<PluginDependency> resolveToolPluginDependencies(ScriptDefinition script) {
        Map<String, String> installedPluginVersions = new LinkedHashMap<>();
        for (PluginView plugin : pluginRuntimeService.list()) {
            installedPluginVersions.put(plugin.getPluginId(), plugin.getVersion());
        }
        Map<String, PluginDependency> dependencies = new LinkedHashMap<>();
        mergePluginDependencies(dependencies, script.getPluginDependencies());
        PublishedScriptSnapshot snapshot = script.getPublishedSnapshot();
        mergePluginDependencies(
                dependencies,
                extractPluginDependenciesFromSource(snapshot == null ? script.getSource() : snapshot.getSource(), installedPluginVersions)
        );
        return List.copyOf(dependencies.values());
    }

    static List<PluginDependency> extractPluginDependenciesFromSource(String source, Map<String, String> installedPluginVersions) {
        if (source == null || source.isBlank()) {
            return List.of();
        }

        Map<String, LinkedHashSet<String>> actionsByPlugin = new LinkedHashMap<>();
        Matcher matcher = GROOVY_PLUGIN_INVOKE_PATTERN.matcher(source);
        while (matcher.find()) {
            String pluginId = matcher.group(2).trim();
            String action = matcher.group(4).trim();
            if (pluginId.isBlank() || action.isBlank()) {
                continue;
            }
            actionsByPlugin.computeIfAbsent(pluginId, ignored -> new LinkedHashSet<>()).add(action);
        }

        List<PluginDependency> dependencies = new ArrayList<>();
        for (Map.Entry<String, LinkedHashSet<String>> entry : actionsByPlugin.entrySet()) {
            String version = installedPluginVersions == null ? null : installedPluginVersions.get(entry.getKey());
            dependencies.add(new PluginDependency()
                    .setPluginId(entry.getKey())
                    .setVersionRange(version == null || version.isBlank() ? null : ">= " + version)
                    .setRequiredActions(new ArrayList<>(entry.getValue())));
        }
        return dependencies;
    }

    private void mergePluginDependencies(Map<String, PluginDependency> target, List<PluginDependency> source) {
        for (PluginDependency dependency : source == null ? List.<PluginDependency>of() : source) {
            if (dependency.getPluginId() == null || dependency.getPluginId().isBlank()) {
                continue;
            }
            PluginDependency existing = target.computeIfAbsent(dependency.getPluginId(), pluginId -> new PluginDependency()
                    .setPluginId(pluginId)
                    .setRequiredActions(List.of()));
            if ((existing.getVersionRange() == null || existing.getVersionRange().isBlank())
                    && dependency.getVersionRange() != null && !dependency.getVersionRange().isBlank()) {
                existing.setVersionRange(dependency.getVersionRange());
            }
            LinkedHashSet<String> actions = new LinkedHashSet<>(existing.getRequiredActions());
            actions.addAll(dependency.getRequiredActions());
            existing.setRequiredActions(new ArrayList<>(actions));
        }
    }

    private List<ConfigTemplateItem> buildConfigTemplate(RepositoryPublishRequest request) {
        List<ConfigTemplateItem> templates = new ArrayList<>();
        for (RepositoryPublishConfigItem item : request.configItems() == null ? List.<RepositoryPublishConfigItem>of() : request.configItems()) {
            ConfigValue value = configValueApplicationService.get(item.key());
            boolean inline = !value.isSecret() && "INLINE".equalsIgnoreCase(item.publishMode());
            templates.add(new ConfigTemplateItem(
                    value.getKey(),
                    value.getDescription(),
                    "string",
                    false,
                    value.isSecret() || !inline,
                    inline ? value.getValue() : null
            ));
        }
        return templates;
    }

    private PluginArtifactRef completePluginArtifactRef(String pluginId,
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
            verifySha256(pluginId, resolved.content(), requested.sha256());
        }
        verifySize(pluginId, resolved.content(), requested.size());
        return new PluginArtifactRef(
                requested.uri(),
                requested.sha256() == null ? sha256(resolved.content()) : requested.sha256(),
                requested.fileName() == null ? resolved.fileName() : requested.fileName(),
                requested.size() == null ? (long) resolved.content().length : requested.size()
        );
    }

    private void ensureLocalPublishArtifactPresent(String pluginId,
                                                   PluginArtifactRef artifact,
                                                   RepositoryDefinition repository,
                                                   Path repositoryRoot) {
        URI uri = URI.create(artifact.uri());
        if (!"local".equalsIgnoreCase(uri.getScheme()) || "HTTP".equals(repository.getType())) {
            return;
        }
        Path target = resolveLocalArtifactPath(repositoryRoot, uri);
        if (Files.exists(target)) {
            return;
        }
        try {
            Files.createDirectories(target.getParent());
            Files.write(target, pluginRuntimeService.readPluginFile(pluginId));
        } catch (IOException exception) {
            throw new IllegalStateException("写入本地插件 JAR 失败: " + artifact.uri(), exception);
        }
    }

    private Path resolveLocalArtifactPath(Path repositoryRoot, URI uri) {
        String relativePath = uri.getSchemeSpecificPart();
        if (relativePath != null && relativePath.startsWith("//")) {
            relativePath = relativePath.substring(2);
        }
        if (relativePath == null || relativePath.isBlank()) {
            throw new IllegalArgumentException("local artifact 路径不能为空");
        }
        if (relativePath.contains("..")) {
            throw new IllegalArgumentException("local artifact 不允许包含 ..");
        }
        if (relativePath.matches("^[A-Za-z]:[\\\\/].*")) {
            throw new IllegalArgumentException("local artifact 不允许使用绝对路径");
        }
        Path parsed = Path.of(relativePath);
        if (parsed.isAbsolute()) {
            throw new IllegalArgumentException("local artifact 不允许使用绝对路径");
        }
        Path normalizedRoot = repositoryRoot.toAbsolutePath().normalize();
        Path target = normalizedRoot.resolve(parsed).normalize();
        if (!target.startsWith(normalizedRoot)) {
            throw new IllegalArgumentException("local artifact 越界访问被拒绝");
        }
        return target;
    }

    private PluginArtifactRef validatePluginArtifactRef(PluginArtifactRef artifact, boolean requireSha256) {
        if (artifact == null) {
            throw new IllegalArgumentException("插件 artifact 不能为空");
        }
        String uri = normalize(artifact.uri(), "插件 artifact.uri 不能为空");
        String sha256 = requireSha256
                ? normalize(artifact.sha256(), "插件 artifact.sha256 不能为空")
                : normalizeNullable(artifact.sha256());
        if (artifact.size() != null && artifact.size() < 0) {
            throw new IllegalArgumentException("插件 artifact.size 不能为负数");
        }
        return new PluginArtifactRef(
                uri,
                sha256,
                normalizeNullable(artifact.fileName()),
                artifact.size()
        );
    }

    private List<ScheduleTemplateItem> buildScheduleTemplate(RepositoryPublishRequest request) {
        List<ScheduleTemplateItem> templates = new ArrayList<>();
        List<String> targetIds = request.scheduleIds() == null ? List.of() : request.scheduleIds();
        for (String scheduleId : targetIds) {
            ScriptSchedule schedule = scriptScheduleRepository.findById(scheduleId)
                    .orElseThrow(() -> new IllegalArgumentException("定时任务不存在: " + scheduleId));
            templates.add(new ScheduleTemplateItem(schedule.getId(), schedule.getName(), schedule.getCronExpression(), schedule.getInput(), false));
        }
        return templates;
    }

    private void updateRepositoryIndex(Path root,
                                       RepositoryDefinition repository,
                                       String toolId,
                                       ScriptDefinition script,
                                       RepositoryPublishRequest request) {
        RepositoryIndexFile current = Files.exists(root.resolve(REPOSITORY_INDEX_FILE))
                ? readJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryIndexFile.class)
                : new RepositoryIndexFile(1, repository.getName(), repository.getDescription(), new ArrayList<>(), new ArrayList<>());
        List<RepositoryIndexEntry> entries = new ArrayList<>(current.tools() == null ? List.of() : current.tools());
        RepositoryIndexEntry next = new RepositoryIndexEntry(
                toolId,
                normalizeOrDefault(request.displayName(), script.getName()),
                normalize(request.version(), "version 不能为空"),
                script.getType().name(),
                normalizeNullable(script.getDescription()),
                normalizeNullable(request.releaseNotes()),
                "tools/" + toolId + "/tool.json"
        );
        entries.removeIf(item -> toolId.equals(item.id()));
        entries.add(next);
        entries.sort(Comparator.comparing(RepositoryIndexEntry::id));
        writeJson(root.resolve(REPOSITORY_INDEX_FILE), new RepositoryIndexFile(
                1,
                repository.getName(),
                normalizeNullable(repository.getDescription()),
                entries,
                new ArrayList<>(safePlugins(current))
        ));
    }

    private void updateRepositoryPluginIndex(Path root,
                                             RepositoryDefinition repository,
                                             String pluginId,
                                             String displayName,
                                             RepositoryPluginPublishRequest request,
                                             String version) {
        RepositoryIndexFile current = Files.exists(root.resolve(REPOSITORY_INDEX_FILE))
                ? readJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryIndexFile.class)
                : new RepositoryIndexFile(1, repository.getName(), repository.getDescription(), new ArrayList<>(), new ArrayList<>());
        List<RepositoryPluginIndexEntry> entries = new ArrayList<>(safePlugins(current));
        RepositoryPluginIndexEntry next = new RepositoryPluginIndexEntry(
                pluginId,
                displayName,
                version,
                normalizeNullable(request.description()),
                normalizeNullable(request.releaseNotes()),
                "plugins/" + pluginId + "/plugin.json"
        );
        entries.removeIf(item -> pluginId.equals(item.id()));
        entries.add(next);
        entries.sort(Comparator.comparing(RepositoryPluginIndexEntry::id));
        writeJson(root.resolve(REPOSITORY_INDEX_FILE), new RepositoryIndexFile(
                1,
                repository.getName(),
                normalizeNullable(repository.getDescription()),
                new ArrayList<>(safeTools(current)),
                entries
        ));
    }

    private void commitAndPush(RepositoryDefinition repository, String toolId, String version, String releaseNotes) {
        Path root = resolveRepositoryRoot(repository);
        runGit(root, List.of("git", "-C", root.toString(), "add", "."));
        List<String> commitCommand = new ArrayList<>(List.of(
                "git", "-C", root.toString(), "commit", "-m", "publish(" + toolId + "): " + version
        ));
        String normalizedReleaseNotes = normalizeNullable(releaseNotes);
        if (normalizedReleaseNotes != null) {
            commitCommand.add("-m");
            commitCommand.add(normalizedReleaseNotes);
        }
        runGit(root, commitCommand, true);
        runGit(root, List.of("git", "-C", root.toString(), "push", "origin", normalizeOrDefault(repository.getBranch(), "main")));
    }

    private Map<String, Object> readSchema(String repositoryId, String schemaPath) {
        if (schemaPath == null || schemaPath.isBlank()) {
            return Map.of();
        }
        return readJsonObject(readRepositoryFile(getRepository(repositoryId), Path.of(schemaPath)));
    }

    private RepositoryToolDescriptor toDescriptor(RepositoryDefinition repository, ToolFile tool, String toolPath) {
        String installedScriptId = repository.getId() + "." + tool.id();
        RepositoryToolInstallation installation = repositoryToolInstallationRepository.findByToolId(installedScriptId).orElse(null);
        ScriptDefinition developmentScript = scriptRepository.findAll().stream()
                .filter(script -> script.getScope() == ScriptScope.DEVELOPMENT)
                .filter(script -> repository.getId().equals(script.getRepositoryId()))
                .filter(script -> tool.id().equals(script.getRepositoryToolId()))
                .findFirst()
                .orElse(null);
        String developmentSyncState = null;
        boolean developmentDirty = false;
        boolean developmentRemoteChanged = false;
        if (developmentScript != null) {
            ToolSourceState state = resolveToolSourceState(repository, new RepositoryToolDetail(
                    toDescriptorWithoutDevelopment(repository, tool, toolPath),
                    readRepositoryFile(repository, toolDirectoryPath(toolPath).resolve(tool.sourcePath())),
                    List.of(),
                    List.of()
            ));
            String localDigest = computeDevelopmentLocalDigest(developmentScript);
            developmentSyncState = resolveDevelopmentSyncState(developmentScript, localDigest, state);
            developmentDirty = isLocalChanged(developmentScript, localDigest);
            developmentRemoteChanged = isRemoteChanged(developmentScript, state);
        }
        RepositoryToolDescriptor base = toDescriptorWithoutDevelopment(repository, tool, toolPath);
        return new RepositoryToolDescriptor(
                base.repositoryId(),
                base.toolId(),
                base.installedScriptId(),
                base.displayName(),
                base.version(),
                base.description(),
                base.releaseNotes(),
                base.owner(),
                base.tags(),
                base.type(),
                base.sourcePath(),
                base.inputSchemaPath(),
                base.outputSchemaPath(),
                base.configTemplatePath(),
                base.scheduleTemplatePath(),
                base.digest(),
                base.riskLevel(),
                base.pluginDependencies(),
                base.installed(),
                base.installedVersion(),
                base.updateAvailable(),
                base.trusted(),
                base.repositoryUsage(),
                developmentScript == null ? null : developmentScript.getId(),
                developmentDirty,
                developmentRemoteChanged,
                developmentSyncState
        );
    }

    private RepositoryToolDescriptor toDescriptorWithoutDevelopment(RepositoryDefinition repository, ToolFile tool, String toolPath) {
        String installedScriptId = repository.getId() + "." + tool.id();
        RepositoryToolInstallation installation = repositoryToolInstallationRepository.findByToolId(installedScriptId).orElse(null);
        return new RepositoryToolDescriptor(
                repository.getId(),
                tool.id(),
                installedScriptId,
                tool.name(),
                tool.version(),
                tool.description(),
                tool.releaseNotes(),
                tool.owner(),
                tool.tags() == null ? List.of() : tool.tags(),
                tool.type(),
                tool.sourcePath(),
                resolveRelative(toolPath, tool.inputSchemaPath()),
                resolveRelative(toolPath, tool.outputSchemaPath()),
                resolveRelative(toolPath, tool.configTemplatePath()),
                resolveRelative(toolPath, tool.scheduleTemplatePath()),
                tool.digest(),
                tool.riskLevel(),
                tool.pluginDependencies() == null ? List.of() : tool.pluginDependencies(),
                installation != null,
                installation == null ? null : installation.getVersion(),
                installation != null && !Objects.equals(installation.getVersion(), tool.version()),
                "TRUSTED".equalsIgnoreCase(repository.getTrustLevel()),
                normalizeOrDefault(repository.getUsage(), "DISTRIBUTION"),
                null,
                false,
                false,
                null
        );
    }

    private RepositoryPluginDescriptor toPluginDescriptor(RepositoryDefinition repository, PluginFile plugin, String pluginPath) {
        PluginRegistration registration = findPluginRegistration(plugin.pluginId()).orElse(null);
        return new RepositoryPluginDescriptor(
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
                "TRUSTED".equalsIgnoreCase(repository.getTrustLevel()),
                dependentToolCount(plugin.pluginId())
        );
    }

    private int dependentToolCount(String pluginId) {
        int count = 0;
        for (ScriptDefinition script : scriptRepository.findAll()) {
            boolean dependsOnPlugin = script.getPluginDependencies().stream()
                    .anyMatch(dependency -> pluginId.equals(dependency.getPluginId()));
            if (dependsOnPlugin) {
                count++;
            }
        }
        return count;
    }

    private void syncGitRepository(RepositoryDefinition repository) {
        Path root = resolveRepositoryRoot(repository);
        try {
            Files.createDirectories(repositoriesRoot);
        } catch (IOException exception) {
            throw new IllegalStateException("创建本地仓库目录失败", exception);
        }
        if (Files.notExists(root)) {
            runGit(repositoriesRoot, List.of(
                    "git", "clone", "--branch", normalizeOrDefault(repository.getBranch(), "main"),
                    "--single-branch", repository.getUrl(), root.toString()
            ));
            return;
        }
        runGit(root, List.of("git", "-C", root.toString(), "fetch", "origin", normalizeOrDefault(repository.getBranch(), "main")));
        runGit(root, List.of("git", "-C", root.toString(), "checkout", normalizeOrDefault(repository.getBranch(), "main")));
        runGit(root, List.of("git", "-C", root.toString(), "pull", "--ff-only", "origin", normalizeOrDefault(repository.getBranch(), "main")));
    }

    private void ensureLocalDirRepository(RepositoryDefinition repository) {
        Path root = resolveRepositoryRoot(repository);
        try {
            Files.createDirectories(root);
            Files.createDirectories(root.resolve("tools"));
        } catch (IOException exception) {
            throw new IllegalStateException("创建本地目录仓库失败: " + root, exception);
        }
        Path indexPath = root.resolve(REPOSITORY_INDEX_FILE);
        if (!Files.exists(indexPath)) {
            writeJson(indexPath, new RepositoryIndexFile(
                    1,
                    normalizeOrDefault(repository.getName(), repository.getId()),
                    normalizeNullable(repository.getDescription()),
                    new ArrayList<>(),
                    new ArrayList<>()
            ));
        }
    }

    private RepositoryIndexFile readRepositoryIndex(RepositoryDefinition repository) {
        if ("HTTP".equals(repository.getType())) {
            return readHttpJson(joinHttpPath(repository.getUrl(), REPOSITORY_INDEX_FILE), RepositoryIndexFile.class);
        }
        Path root = resolveRepositoryRoot(repository);
        if ("LOCAL_DIR".equals(repository.getType())) {
            ensureLocalDirRepository(repository);
        }
        if ("GIT".equals(repository.getType()) && Files.notExists(root)) {
            syncGitRepository(repository);
        }
        return readJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryIndexFile.class);
    }

    private ToolFile readToolFile(RepositoryDefinition repository, String toolPath) {
        if ("HTTP".equals(repository.getType())) {
            return readHttpJson(joinHttpPath(repository.getUrl(), toolPath), ToolFile.class);
        }
        return readJson(resolveRepositoryRoot(repository).resolve(toolPath), ToolFile.class);
    }

    private PluginFile readPluginFile(RepositoryDefinition repository, String pluginPath) {
        if ("HTTP".equals(repository.getType())) {
            return readHttpJson(joinHttpPath(repository.getUrl(), pluginPath), PluginFile.class);
        }
        return readJson(resolveRepositoryRoot(repository).resolve(pluginPath), PluginFile.class);
    }

    private String readRepositoryFile(RepositoryDefinition repository, Path path) {
        if ("HTTP".equals(repository.getType())) {
            return readHttpText(joinHttpPath(repository.getUrl(), path.toString().replace('\\', '/')));
        }
        try {
            return Files.readString(resolveRepositoryRoot(repository).resolve(path), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new IllegalStateException("读取仓库文件失败: " + path, exception);
        }
    }

    private byte[] readRepositoryBytes(RepositoryDefinition repository, Path path) {
        if ("HTTP".equals(repository.getType())) {
            return readHttpBytes(joinHttpPath(repository.getUrl(), path.toString().replace('\\', '/')));
        }
        try {
            return Files.readAllBytes(resolveRepositoryRoot(repository).resolve(path));
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

    private Path resolveRepositoryRoot(RepositoryDefinition repository) {
        if ("LOCAL_DIR".equals(repository.getType())) {
            return Path.of(repository.getUrl());
        }
        return repositoriesRoot.resolve(repository.getId());
    }

    private <T> T readJson(Path path, Class<T> type) {
        try (InputStream stream = Files.newInputStream(path)) {
            String raw = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
            assertLatestRepositoryMetadata(raw, type, path.toString());
            return jsonCodec.read(raw, type);
        } catch (IOException exception) {
            throw new IllegalStateException("读取仓库文件失败: " + path, exception);
        }
    }

    private <T> T readHttpJson(String url, Class<T> type) {
        String text = readHttpText(url);
        assertLatestRepositoryMetadata(text, type, url);
        return jsonCodec.read(text, type);
    }

    static void assertLatestRepositoryMetadata(String raw, Class<?> type, String source) {
        if (type != RepositoryIndexFile.class && type != ToolFile.class && type != PluginFile.class) {
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
        if (type == RepositoryIndexFile.class) {
            assertRepositoryIndexEntriesIncludeReleaseNotes(root.get("tools"), source, "tools");
            assertRepositoryIndexEntriesIncludeReleaseNotes(root.get("plugins"), source, "plugins");
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
        HttpRequest request = HttpRequest.newBuilder(URI.create(url)).GET().build();
        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() >= 400) {
                throw new IllegalArgumentException("HTTP 仓库访问失败: " + response.statusCode());
            }
            return response.body();
        } catch (IOException | InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("访问 HTTP 仓库失败: " + url, exception);
        }
    }

    private byte[] readHttpBytes(String url) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url)).GET().build();
        try {
            HttpResponse<byte[]> response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() >= 400) {
                throw new IllegalArgumentException("HTTP 仓库访问失败: " + response.statusCode());
            }
            return response.body();
        } catch (IOException | InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("访问 HTTP 仓库失败: " + url, exception);
        }
    }

    private Map<String, Object> readJsonObject(String content) {
        return jsonCodec.readMap(content);
    }

    private void writeJson(Path path, Object value) {
        try {
            Files.createDirectories(path.getParent());
            Files.writeString(path, jsonCodec.write(value), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new IllegalStateException("写入 JSON 文件失败: " + path, exception);
        }
    }

    private void runGit(Path workdir, List<String> command) {
        runGit(workdir, command, false);
    }

    private void runGit(Path workdir, List<String> command, boolean ignoreNothingToCommit) {
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(workdir.toFile());
        try {
            Process process = builder.start();
            String stdout = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            String stderr = new String(process.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
            int exitCode = process.waitFor();
            if (exitCode != 0) {
                if (ignoreNothingToCommit && stderr.toLowerCase(Locale.ROOT).contains("nothing to commit")) {
                    return;
                }
                throw new IllegalStateException("Git 命令失败: " + String.join(" ", command) + "\n" + stdout + stderr);
            }
        } catch (IOException | InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("执行 Git 命令失败: " + String.join(" ", command), exception);
        }
    }

    private String gitHead(Path root) {
        return runGitOutput(root, List.of("git", "-C", root.toString(), "rev-parse", "HEAD")).trim();
    }

    private String runGitOutput(Path workdir, List<String> command) {
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(workdir.toFile());
        try {
            Process process = builder.start();
            String stdout = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            String stderr = new String(process.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
            int exitCode = process.waitFor();
            if (exitCode != 0) {
                throw new IllegalStateException("Git 命令失败: " + String.join(" ", command) + "\n" + stdout + stderr);
            }
            return stdout;
        } catch (IOException | InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("执行 Git 命令失败: " + String.join(" ", command), exception);
        }
    }

    private String joinHttpPath(String baseUrl, String relativePath) {
        String normalizedBase = normalize(baseUrl, "仓库地址不能为空");
        while (normalizedBase.endsWith("/")) {
            normalizedBase = normalizedBase.substring(0, normalizedBase.length() - 1);
        }
        String normalizedRelative = relativePath.startsWith("/") ? relativePath.substring(1) : relativePath;
        return normalizedBase + "/" + normalizedRelative;
    }

    private String resolveRelative(String toolPath, String nestedPath) {
        if (nestedPath == null || nestedPath.isBlank()) {
            return null;
        }
        return Path.of(toolPath).getParent().resolve(nestedPath).toString().replace('\\', '/');
    }

    private List<RepositoryIndexEntry> safeTools(RepositoryIndexFile index) {
        return index == null || index.tools() == null ? List.of() : index.tools();
    }

    private List<RepositoryPluginIndexEntry> safePlugins(RepositoryIndexFile index) {
        return index == null || index.plugins() == null ? List.of() : index.plugins();
    }

    private RepositoryIndexFile readRepositoryIndexFile(Path root, RepositoryDefinition repository) {
        return Files.exists(root.resolve(REPOSITORY_INDEX_FILE))
                ? readJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryIndexFile.class)
                : new RepositoryIndexFile(1, repository.getName(), repository.getDescription(), new ArrayList<>(), new ArrayList<>());
    }

    static void assertToolVersionAvailable(String repositoryId,
                                           RepositoryIndexFile index,
                                           String toolId,
                                           String version) {
        for (RepositoryIndexEntry entry : index == null || index.tools() == null ? List.<RepositoryIndexEntry>of() : index.tools()) {
            if (Objects.equals(toolId, entry.id()) && Objects.equals(version, entry.version())) {
                throw new RepositoryVersionExistsException("TOOL", repositoryId, toolId, version);
            }
        }
    }

    static void assertPluginVersionAvailable(String repositoryId,
                                             RepositoryIndexFile index,
                                             String pluginId,
                                             String version) {
        for (RepositoryPluginIndexEntry entry : index == null || index.plugins() == null ? List.<RepositoryPluginIndexEntry>of() : index.plugins()) {
            if (Objects.equals(pluginId, entry.id()) && Objects.equals(version, entry.version())) {
                throw new RepositoryVersionExistsException("PLUGIN", repositoryId, pluginId, version);
            }
        }
    }

    private RelativeRepositoryPath toolDirectoryPath(String toolPath) {
        return new RelativeRepositoryPath(Path.of(toolPath).getParent().toString().replace('\\', '/'));
    }

    private String normalize(String value, String message) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(message);
        }
        return value.trim();
    }

    private String normalizeOrDefault(String value, String defaultValue) {
        return value == null || value.isBlank() ? defaultValue : value.trim();
    }

    private String normalizeNullable(String value) {
        return value == null || value.isBlank() ? null : value.trim();
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
            String sourcePath,
            String inputSchemaPath,
            String outputSchemaPath,
            String configTemplatePath,
            String scheduleTemplatePath,
            String digest,
            String riskLevel,
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
    }

    public record RepositoryToolDetail(
            RepositoryToolDescriptor descriptor,
            String source,
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
            boolean force
    ) {
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

    public record RepositoryPluginConflict(
            String scriptId,
            String scriptName,
            String requiredVersionRange
    ) {
    }

    public record RepositoryPublishConfigItem(String key, String publishMode) {
    }

    public record RepositoryIndexFile(int repositoryVersion,
                                      String name,
                                      String description,
                                      List<RepositoryIndexEntry> tools,
                                      List<RepositoryPluginIndexEntry> plugins) {
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

    public record ToolFile(int toolVersion,
                           String id,
                           String name,
                           String version,
                           String type,
                           String description,
                           String releaseNotes,
                           String owner,
                           List<String> tags,
                           String sourcePath,
                           String inputSchemaPath,
                           String outputSchemaPath,
                           String configTemplatePath,
                           String scheduleTemplatePath,
                           String digest,
                           String riskLevel,
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

    public record ConfigTemplateItem(String key,
                                     String label,
                                     String type,
                                     boolean required,
                                     boolean secret,
                                     String defaultValue) {
    }

    public record ScheduleTemplateItem(String id,
                                       String name,
                                       String cronExpression,
                                       Map<String, Object> input,
                                       boolean enabledByDefault) {
    }

    private record RelativeRepositoryPath(String value) {
        private Path resolve(String child) {
            return Path.of(value).resolve(child);
        }

        private RelativeRepositoryPath resolveNullable(String child) {
            if (child == null || child.isBlank()) {
                return null;
            }
            return new RelativeRepositoryPath(Path.of(value).resolve(child).toString().replace('\\', '/'));
        }
    }

    private record ToolSourceState(String path, String commit, String digest) {
    }

    public static class RepositoryPluginConflictException extends IllegalArgumentException {
        private final String pluginId;
        private final List<RepositoryPluginConflict> conflicts;

        public RepositoryPluginConflictException(String pluginId, List<RepositoryPluginConflict> conflicts) {
            super("插件版本会影响已安装工具: " + pluginId);
            this.pluginId = pluginId;
            this.conflicts = conflicts == null ? List.of() : List.copyOf(conflicts);
        }

        public String getPluginId() {
            return pluginId;
        }

        public List<RepositoryPluginConflict> getConflicts() {
            return conflicts;
        }
    }

    public static class RepositoryVersionExistsException extends IllegalArgumentException {
        private final String assetKind;
        private final String repositoryId;
        private final String assetId;
        private final String version;

        public RepositoryVersionExistsException(String assetKind, String repositoryId, String assetId, String version) {
            super(("PLUGIN".equals(assetKind) ? "插件" : "工具") + "版本已存在: " + assetId + "@" + version);
            this.assetKind = assetKind;
            this.repositoryId = repositoryId;
            this.assetId = assetId;
            this.version = version;
        }

        public String getAssetKind() {
            return assetKind;
        }

        public String getRepositoryId() {
            return repositoryId;
        }

        public String getAssetId() {
            return assetId;
        }

        public String getVersion() {
            return version;
        }
    }

    public static class DevelopmentConflictException extends IllegalArgumentException {
        private final String scriptId;
        private final String repositoryId;
        private final String toolId;

        public DevelopmentConflictException(String scriptId, String repositoryId, String toolId) {
            super("远端工具已更新，但本地也有未发布修改");
            this.scriptId = scriptId;
            this.repositoryId = repositoryId;
            this.toolId = toolId;
        }

        public String getScriptId() {
            return scriptId;
        }

        public String getRepositoryId() {
            return repositoryId;
        }

        public String getToolId() {
            return toolId;
        }
    }
}
