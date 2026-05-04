package org.team4u.actiondock.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiCapability;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiModelProvider;
import org.team4u.actiondock.ai.api.AiProvider;
import org.team4u.actiondock.ai.api.AiToolPermission;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ConfigPublishMode;
import org.team4u.actiondock.domain.exception.DevelopmentConflictException;
import org.team4u.actiondock.domain.exception.RepositoryPluginConflict;
import org.team4u.actiondock.domain.exception.RepositoryPluginConflictException;
import org.team4u.actiondock.domain.exception.RepositoryVersionExistsException;
import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.model.AiDependency;
import org.team4u.actiondock.domain.model.ExecutionPreset;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.CapabilityPackageInstallation;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.ScriptStatus;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.model.RepositoryToolInstallation;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.ExecutionPresetRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.CapabilityPackageInstallationRepository;
import org.team4u.actiondock.domain.port.RepositoryDefinitionRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.domain.port.RepositoryToolInstallationRepository;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.plugin.PluginView;
import org.team4u.actiondock.skill.SkillService;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
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
    private static final Pattern PLUGIN_INVOKE_PATTERN = Pattern.compile(
            "plugins\\s*\\.\\s*invoke\\s*\\(\\s*([\"'`])([^\"'`]+)\\1\\s*,\\s*([\"'`])([^\"'`]+)\\3"
    );
    private static final Pattern SCRIPT_INVOKE_PATTERN = Pattern.compile(
            "scripts\\s*\\.\\s*invoke\\s*\\(\\s*([\"'`])([^\"'`]+)\\1"
    );
    private static final Pattern SCRIPT_INVOKE_ANY_PATTERN = Pattern.compile(
            "scripts\\s*\\.\\s*invoke\\s*\\("
    );
    private static final Pattern MODEL_PROFILE_LITERAL_PATTERN = Pattern.compile(
            "((?:[\"'`])?modelProfile(?:[\"'`])?\\s*:\\s*)([\"'`])([^\"'`]+)(\\2)"
    );
    private static final Pattern AGENT_PROFILE_LITERAL_PATTERN = Pattern.compile(
            "((?:[\"'`])?agentProfile(?:[\"'`])?\\s*:\\s*)([\"'`])([^\"'`]+)(\\2)"
    );
    private static final String AI_PACKAGE_ENTRY_PREFIX = "cap.";
    private static final String AI_PACKAGE_INTERNAL_PREFIX = "pkg.";
    private static final String CAPABILITY_PACKAGES_DIR = "packages";
    private static final String CAPABILITY_PACKAGE_MANIFEST_FILE = "package.json";
    private static final String CAPABILITY_PACKAGE_RELEASE_FILE = "release.json";
    private static final String SKILLS_DIR = "skills";
    private static final String SKILL_MANIFEST_FILE = "skill.json";

    private final RepositoryDefinitionRepository repositoryDefinitionRepository;
    private final RepositoryToolInstallationRepository repositoryToolInstallationRepository;
    private final CapabilityPackageInstallationRepository capabilityPackageInstallationRepository;
    private final ScriptRepository scriptRepository;
    private final ScriptScheduleRepository scriptScheduleRepository;
    private final ExecutionPresetRepository executionPresetRepository;
    private final ConfigValueRepository configValueRepository;
    private final AiModelProfileRepository aiModelProfileRepository;
    private final AiAgentProfileRepository aiAgentProfileRepository;
    private final AiToolsetRepository aiToolsetRepository;
    private final ScriptApplicationService scriptApplicationService;
    private final ConfigValueApplicationService configValueApplicationService;
    private final PluginRuntimeService pluginRuntimeService;
    private final JsonCodec jsonCodec;
    private final HttpClient httpClient;
    private final PluginArtifactResolverRegistry pluginArtifactResolverRegistry;
    private final Path repositoriesRoot;
    private final ToolRepositoryPublisher toolRepositoryPublisher;
    private final PluginRepositoryPublisher pluginRepositoryPublisher;

    public RepositoryCatalogService(RepositoryDefinitionRepository repositoryDefinitionRepository,
                                    RepositoryToolInstallationRepository repositoryToolInstallationRepository,
                                    CapabilityPackageInstallationRepository capabilityPackageInstallationRepository,
                                    ScriptRepository scriptRepository,
                                    ScriptScheduleRepository scriptScheduleRepository,
                                    ExecutionPresetRepository executionPresetRepository,
                                    ConfigValueRepository configValueRepository,
                                    AiModelProfileRepository aiModelProfileRepository,
                                    AiAgentProfileRepository aiAgentProfileRepository,
                                    AiToolsetRepository aiToolsetRepository,
                                    ScriptApplicationService scriptApplicationService,
                                    ConfigValueApplicationService configValueApplicationService,
                                    PluginRuntimeService pluginRuntimeService,
                                    JsonCodec jsonCodec,
                                    AppProperties properties) {
        this(repositoryDefinitionRepository,
                repositoryToolInstallationRepository,
                capabilityPackageInstallationRepository,
                scriptRepository,
                scriptScheduleRepository,
                executionPresetRepository,
                configValueRepository,
                aiModelProfileRepository,
                aiAgentProfileRepository,
                aiToolsetRepository,
                scriptApplicationService,
                configValueApplicationService,
                pluginRuntimeService,
                jsonCodec,
                properties,
                new PluginArtifactResolverRegistry(List.of(new LocalPluginArtifactResolver(), new HttpPluginArtifactResolver())));
    }

    public RepositoryCatalogService(RepositoryDefinitionRepository repositoryDefinitionRepository,
                                    RepositoryToolInstallationRepository repositoryToolInstallationRepository,
                                    CapabilityPackageInstallationRepository capabilityPackageInstallationRepository,
                                    ScriptRepository scriptRepository,
                                    ScriptScheduleRepository scriptScheduleRepository,
                                    ExecutionPresetRepository executionPresetRepository,
                                    ConfigValueRepository configValueRepository,
                                    AiModelProfileRepository aiModelProfileRepository,
                                    AiAgentProfileRepository aiAgentProfileRepository,
                                    AiToolsetRepository aiToolsetRepository,
                                    ScriptApplicationService scriptApplicationService,
                                    ConfigValueApplicationService configValueApplicationService,
                                    PluginRuntimeService pluginRuntimeService,
                                    JsonCodec jsonCodec,
                                    AppProperties properties,
                                    PluginArtifactResolverRegistry pluginArtifactResolverRegistry) {
        this.repositoryDefinitionRepository = repositoryDefinitionRepository;
        this.repositoryToolInstallationRepository = repositoryToolInstallationRepository;
        this.capabilityPackageInstallationRepository = capabilityPackageInstallationRepository;
        this.scriptRepository = scriptRepository;
        this.scriptScheduleRepository = scriptScheduleRepository;
        this.executionPresetRepository = executionPresetRepository;
        this.configValueRepository = configValueRepository;
        this.aiModelProfileRepository = aiModelProfileRepository;
        this.aiAgentProfileRepository = aiAgentProfileRepository;
        this.aiToolsetRepository = aiToolsetRepository;
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
        this.toolRepositoryPublisher = new ToolRepositoryPublisher(this);
        this.pluginRepositoryPublisher = new PluginRepositoryPublisher(this);
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
            ensureRepositoryWorkspace(resolveRepositoryRoot(repository), repository, jsonCodec);
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

    public List<CapabilityPackageDescriptor> listAllCapabilityPackages() {
        List<CapabilityPackageDescriptor> packages = new ArrayList<>();
        for (RepositoryDefinition repository : listRepositories()) {
            if (!repository.isEnabled()) {
                continue;
            }
            packages.addAll(listCapabilityPackages(repository.getId()));
        }
        return packages.stream()
                .sorted(Comparator.comparing(CapabilityPackageDescriptor::installationId))
                .toList();
    }

    public List<CapabilityPackageDescriptor> listCapabilityPackages(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryIndexFile index = readRepositoryIndex(repository);
        List<CapabilityPackageDescriptor> packages = new ArrayList<>();
        for (CapabilityPackageIndexEntry entry : safeCapabilityPackages(index)) {
            CapabilityPackageManifestFile manifest = readCapabilityPackageManifest(repository, entry.path());
            packages.add(toCapabilityPackageDescriptor(repository, manifest, entry.path()));
        }
        return packages.stream()
                .sorted(Comparator.comparing(CapabilityPackageDescriptor::installationId))
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

    public List<RepositorySkillDescriptor> listAllRepositorySkills() {
        List<RepositorySkillDescriptor> skills = new ArrayList<>();
        for (RepositoryDefinition repository : listRepositories()) {
            if (!repository.isEnabled()) {
                continue;
            }
            skills.addAll(listRepositorySkills(repository.getId()));
        }
        return skills.stream()
                .sorted(Comparator.comparing(RepositorySkillDescriptor::skillId))
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

    public List<RepositorySkillDescriptor> listRepositorySkills(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryIndexFile index = readRepositoryIndex(repository);
        List<RepositorySkillDescriptor> skills = new ArrayList<>();
        for (RepositorySkillIndexEntry entry : safeSkills(index)) {
            SkillFile skill = readSkillFile(repository, entry.skillPath());
            skills.add(toSkillDescriptor(repository, skill, entry.skillPath()));
        }
        return skills.stream()
                .sorted(Comparator.comparing(RepositorySkillDescriptor::skillId))
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

    public RepositorySkillDetail getRepositorySkill(String repositoryId, String skillId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositorySkillIndexEntry entry = safeSkills(index).stream()
                .filter(item -> skillId.equals(item.id()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("仓库 Skill 不存在: " + skillId));
        SkillFile skill = readSkillFile(repository, entry.skillPath());
        String content = readRepositoryFile(repository, skillDirectoryPath(entry.skillPath()).resolve(skill.entrypointPath()));
        return new RepositorySkillDetail(toSkillDescriptor(repository, skill, entry.skillPath()), content);
    }

    public RepositoryBinaryArchive exportRepositorySkillArchive(String repositoryId, String skillId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        if ("HTTP".equals(repository.getType())) {
            throw new IllegalArgumentException("HTTP 仓库暂不支持导出 Skill 归档");
        }
        RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositorySkillIndexEntry entry = safeSkills(index).stream()
                .filter(item -> skillId.equals(item.id()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("仓库 Skill 不存在: " + skillId));
        SkillFile skill = readSkillFile(repository, entry.skillPath());
        Path skillRoot = safeResolveRepositoryPath(resolveRepositoryRoot(repository), skillDirectoryPath(entry.skillPath()).value());
        SkillService.SkillValidationResult validation = SkillService.validateSkillDirectory(skillRoot, skill.skillId(), true, jsonCodec);
        return new RepositoryBinaryArchive(
                validation.skillId() + ".zip",
                SkillService.buildArchive(skillRoot, validation, validation.version(), jsonCodec)
        );
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
        String pythonRequirements = tool.pythonRequirementsPath() == null || tool.pythonRequirementsPath().isBlank()
                ? null
                : readRepositoryFile(repository, toolDirectoryPath(entry.toolPath()).resolve(tool.pythonRequirementsPath()));
        return new RepositoryToolDetail(toDescriptor(repository, tool, entry.toolPath()), source, pythonRequirements, configTemplate, scheduleTemplate);
    }

    public CapabilityPackageDetail getCapabilityPackage(String repositoryId, String packageId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryIndexFile index = readRepositoryIndex(repository);
        CapabilityPackageIndexEntry entry = safeCapabilityPackages(index).stream()
                .filter(item -> packageId.equals(item.id()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("仓库能力包不存在: " + packageId));
        CapabilityPackageManifestFile manifest = readCapabilityPackageManifest(repository, entry.path());
        CapabilityPackageReleaseFile release = readCapabilityPackageRelease(repository, manifest.latestReleasePath());
        List<ConfigTemplateItem> configTemplate = readOptionalFile(
                repository,
                capabilityPackageDirectoryPath(manifest.latestReleasePath()).resolveNullable(release.configTemplatePath()),
                ConfigTemplateItem.class
        );
        List<ScheduleTemplateItem> scheduleTemplate = readOptionalFile(
                repository,
                capabilityPackageDirectoryPath(manifest.latestReleasePath()).resolveNullable(release.scheduleTemplatePath()),
                ScheduleTemplateItem.class
        );
        List<CapabilityPackagePresetTemplate> presetTemplate = readOptionalFile(
                repository,
                capabilityPackageDirectoryPath(manifest.latestReleasePath()).resolveNullable(release.presetTemplatePath()),
                CapabilityPackagePresetTemplate.class
        );
        return new CapabilityPackageDetail(
                toCapabilityPackageDescriptor(repository, manifest, entry.path()),
                configTemplate,
                scheduleTemplate,
                presetTemplate,
                release
        );
    }

    public RepositoryToolInstallation installTool(String repositoryId, String toolId, boolean installSchedules) {
        return installTool(repositoryId, toolId, installSchedules, false, false, false);
    }

    public RepositoryToolInstallation installTool(String repositoryId,
                                                 String toolId,
                                                 boolean installSchedules,
                                                 boolean installPluginDependencies,
                                                 boolean forcePluginUpgrade) {
        return installTool(repositoryId, toolId, installSchedules, false, installPluginDependencies, forcePluginUpgrade);
    }

    public RepositoryToolInstallation installTool(String repositoryId,
                                                  String toolId,
                                                  boolean installSchedules,
                                                  boolean installScriptDependencies,
                                                  boolean installPluginDependencies,
                                                  boolean forcePluginUpgrade) {
        return installOrUpdateTool(
                repositoryId,
                toolId,
                installSchedules,
                false,
                installScriptDependencies,
                installPluginDependencies,
                forcePluginUpgrade,
                new LinkedHashSet<>()
        );
    }

    public RepositoryToolInstallation updateTool(String repositoryId, String toolId, boolean installSchedules) {
        return updateTool(repositoryId, toolId, installSchedules, false, false, false);
    }

    public RepositoryToolInstallation updateTool(String repositoryId,
                                                String toolId,
                                                boolean installSchedules,
                                                boolean installPluginDependencies,
                                                boolean forcePluginUpgrade) {
        return updateTool(repositoryId, toolId, installSchedules, false, installPluginDependencies, forcePluginUpgrade);
    }

    public RepositoryToolInstallation updateTool(String repositoryId,
                                                 String toolId,
                                                 boolean installSchedules,
                                                 boolean installScriptDependencies,
                                                 boolean installPluginDependencies,
                                                 boolean forcePluginUpgrade) {
        return installOrUpdateTool(
                repositoryId,
                toolId,
                installSchedules,
                true,
                installScriptDependencies,
                installPluginDependencies,
                forcePluginUpgrade,
                new LinkedHashSet<>()
        );
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
        ScriptPackaging packaging = resolvePackaging(detail.descriptor().packaging());
        Map<String, Object> inputSchema = readSchema(detail.descriptor().repositoryId(), detail.descriptor().inputSchemaPath());
        Map<String, Object> outputSchema = readSchema(detail.descriptor().repositoryId(), detail.descriptor().outputSchemaPath());
        ScriptDefinition definition = new ScriptDefinition()
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
                .setScriptDependencies(detail.descriptor().scriptDependencies())
                .setPluginDependencies(detail.descriptor().pluginDependencies())
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now);
        return scriptRepository.save(definition);
    }

    void assertDevelopmentPublishSafe(ScriptDefinition script, RepositoryDefinition repository) {
        RepositoryToolDetail detail = getRepositoryTool(repository.getId(), script.getRepositoryToolId());
        ToolSourceState state = resolveToolSourceState(repository, detail);
        String syncState = resolveDevelopmentSyncState(script, computeDevelopmentLocalDigest(script), state);
        if ("REMOTE_CHANGES".equals(syncState) || "DIVERGED".equals(syncState)) {
            throw new DevelopmentConflictException(script.getId(), script.getRepositoryId(), script.getRepositoryToolId());
        }
    }

    void updateDevelopmentSourceMetadata(ScriptDefinition sourceScript,
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

    public RepositoryPublishConfigPreview previewPublishConfig(RepositoryPublishConfigPreviewRequest request) {
        String scriptId = normalize(request == null ? null : request.scriptId(), "scriptId 不能为空");
        List<ScriptSchedule> schedules = resolvePublishSchedules(scriptId, request == null ? null : request.scheduleIds());
        RepositoryPublishConfigResolver.PublishConfigResolution resolution = RepositoryPublishConfigResolver.resolve(
                request == null ? null : request.source(),
                schedules.stream().map(ScriptSchedule::getInput).toList(),
                configValueRepository.findAll()
        );
        return new RepositoryPublishConfigPreview(
                resolution.items().stream()
                        .map(item -> new RepositoryPublishConfigCandidate(item.key(), item.label(), item.secret()))
                        .toList(),
                resolution.missingKeys()
        );
    }

    public CapabilityPackagePublishPreview previewCapabilityPackage(String repositoryId,
                                                                    CapabilityPackagePublishPreviewRequest request) {
        RepositoryDefinition repository = getRepository(repositoryId);
        CapabilityPackageDraft draft = buildCapabilityPackageDraft(repository, request);
        return buildCapabilityPackagePublishPreview(repository, draft);
    }

    public RepositoryToolDescriptor publishTool(String repositoryId, RepositoryPublishRequest request) {
        return toolRepositoryPublisher.publish(repositoryId, request);
    }

    public CapabilityPackageDescriptor publishCapabilityPackage(String repositoryId, CapabilityPackagePublishRequest request) {
        WritableRepositorySession session = openWritableRepositorySession(repositoryId);
        RepositoryDefinition repository = session.repository();
        CapabilityPackageDraft draft = buildCapabilityPackageDraft(repository, request);
        CapabilityPackagePublishPreview preview = buildCapabilityPackagePublishPreview(repository, draft);
        if (preview.checks().stream().anyMatch(item -> "BLOCKER".equals(item.severity()))) {
            throw new IllegalArgumentException("能力包存在阻断项，不能发布");
        }
        assertCapabilityPackageVersionAvailable(repositoryId, session.index(), draft.packageId(), draft.version());
        Path packageRoot = session.root().resolve(CAPABILITY_PACKAGES_DIR).resolve(draft.packageId());
        writeCapabilityPackageFiles(packageRoot, draft, preview);
        updateCapabilityPackageIndex(session.root(), repository, draft, preview);
        session.commitPublishedAsset(draft.packageId(), draft.version(), draft.releaseNotes());
        return getCapabilityPackage(repositoryId, draft.packageId()).descriptor();
    }

    public CapabilityPackageInstallResult installCapabilityPackage(String repositoryId, String packageId) {
        return installOrUpdateCapabilityPackage(repositoryId, packageId, false, new LinkedHashSet<>());
    }

    public CapabilityPackageInstallResult updateCapabilityPackage(String repositoryId, String packageId) {
        return installOrUpdateCapabilityPackage(repositoryId, packageId, true, new LinkedHashSet<>());
    }

    public void uninstallCapabilityPackage(String repositoryId, String packageId) {
        CapabilityPackageInstallation installation = capabilityPackageInstallationRepository
                .findByInstallationId(capabilityPackageInstallationId(repositoryId, packageId))
                .orElseThrow(() -> new IllegalArgumentException("能力包尚未安装: " + packageId));
        uninstallManagedCapabilityPackageAssets(installation);
        for (String presetId : installation.getPresetIds()) {
            executionPresetRepository.deleteById(presetId);
        }
        capabilityPackageInstallationRepository.deleteByInstallationId(installation.getInstallationId());
        removeManagedConfigTemplates(repositoryId, packageId);
    }

    public RepositoryPluginDescriptor publishPlugin(String repositoryId, RepositoryPluginPublishRequest request) {
        return pluginRepositoryPublisher.publish(repositoryId, request);
    }

    public RepositorySkillDescriptor publishSkillArchive(String repositoryId,
                                                         String releaseNotes,
                                                         String fileName,
                                                         byte[] content) {
        RepositoryDefinition repository = getRepository(repositoryId);
        if ("HTTP".equals(repository.getType())) {
            throw new IllegalArgumentException("HTTP 仓库暂不支持发布");
        }
        Path tempDir = null;
        try {
            tempDir = Files.createTempDirectory(repositoriesRoot, "skill-publish-archive-");
            SkillService.unzipArchive(content, tempDir);
            Path skillRoot = SkillService.locateSkillRoot(tempDir);
            SkillService.SkillValidationResult validation = SkillService.validateSkillDirectory(skillRoot, fileName, false, jsonCodec);
            return publishSkillDirectory(repository, skillRoot, validation, releaseNotes);
        } catch (IOException exception) {
            throw new IllegalStateException("写入 Skill 仓库文件失败", exception);
        } finally {
            deleteQuietly(tempDir);
        }
    }

    private RepositorySkillDescriptor publishSkillDirectory(RepositoryDefinition repository,
                                                            Path skillRoot,
                                                            SkillService.SkillValidationResult validation,
                                                            String releaseNotes) {
        String normalizedVersion = normalize(validation.version(), "version 不能为空");
        String skillId = normalize(validation.skillId(), "skillId 不能为空");
        Path root = resolveRepositoryRoot(repository);
        ensureRepositoryWorkspace(root, repository, jsonCodec);
        assertSkillVersionAvailable(repository.getId(), readRepositoryIndexFile(root, repository), skillId, normalizedVersion);
        Path skillDir = root.resolve(SKILLS_DIR).resolve(skillId);
        Path tempSkillDir = skillDir.getParent().resolve(skillId + ".tmp-" + UUID.randomUUID());
        Path backupDir = skillDir.getParent().resolve(skillId + ".bak-" + UUID.randomUUID());
        try {
            Files.createDirectories(skillDir.getParent());
            copyDirectory(skillRoot, tempSkillDir);
            deleteQuietly(tempSkillDir.resolve(".actiondock-skill-install.json"));
            SkillService.writeManifest(tempSkillDir, validation, normalizedVersion, jsonCodec);
            if (Files.exists(skillDir)) {
                moveAtomically(skillDir, backupDir);
            }
            moveAtomically(tempSkillDir, skillDir);
            deleteQuietly(backupDir);
            updateRepositorySkillIndex(root, repository, validation, normalizedVersion, releaseNotes);
        } catch (IOException exception) {
            deleteQuietly(tempSkillDir);
            throw new IllegalStateException("写入 Skill 仓库文件失败", exception);
        }
        if ("GIT".equals(repository.getType())) {
            commitAndPush(repository, skillId, normalizedVersion, releaseNotes);
        }
        return getRepositorySkill(repository.getId(), skillId).descriptor();
    }

    WritableRepositorySession openWritableRepositorySession(String repositoryId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        if ("HTTP".equals(repository.getType())) {
            throw new IllegalArgumentException("HTTP 仓库暂不支持发布");
        }
        if ("GIT".equals(repository.getType())) {
            syncRepository(repositoryId);
        } else {
            ensureLocalDirRepository(repository);
        }
        Path root = resolveRepositoryRoot(repository);
        return new WritableRepositorySession(this, repository, root, readRepositoryIndexFile(root, repository));
    }

    ScriptApplicationService scriptApplicationService() {
        return scriptApplicationService;
    }

    ConfigValueRepository configValueRepository() {
        return configValueRepository;
    }

    private RepositoryToolInstallation installOrUpdateTool(String repositoryId,
                                                           String toolId,
                                                           boolean installSchedules,
                                                           boolean updateOnly,
                                                           boolean installScriptDependencies,
                                                           boolean installPluginDependencies,
                                                           boolean forcePluginUpgrade,
                                                           LinkedHashSet<String> visiting) {
        String installationKey = repositoryId + ":" + toolId;
        if (!visiting.add(installationKey)) {
            throw new IllegalStateException("检测到脚本循环依赖: " + String.join(" -> ", visiting) + " -> " + installationKey);
        }
        try {
            RepositoryToolDetail detail = getRepositoryTool(repositoryId, toolId);
            String installedScriptId = detail.descriptor().installedScriptId();
            ScriptDefinition existing = scriptRepository.findById(installedScriptId).orElse(null);
            if (updateOnly && existing == null) {
                throw new IllegalArgumentException("工具尚未安装: " + installedScriptId);
            }
            resolveScriptDependencies(
                    detail.descriptor().scriptDependencies(),
                    installScriptDependencies,
                    installPluginDependencies,
                    forcePluginUpgrade,
                    visiting
            );
            resolvePluginDependencies(repositoryId, detail.descriptor().pluginDependencies(), installPluginDependencies, forcePluginUpgrade);

            LocalDateTime now = LocalDateTime.now();
            ScriptPackaging packaging = resolvePackaging(detail.descriptor().packaging());
            Map<String, Object> inputSchema = readSchema(repositoryId, detail.descriptor().inputSchemaPath());
            Map<String, Object> outputSchema = readSchema(repositoryId, detail.descriptor().outputSchemaPath());
            ScriptDefinition definition = new ScriptDefinition()
                    .setId(installedScriptId)
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
                    .setVersion(existing == null ? 1 : (existing.getVersion() == null ? 1 : existing.getVersion() + 1))
                    .setScope(ScriptScope.REPOSITORY)
                    .setRepositoryId(repositoryId)
                    .setRepositoryToolId(detail.descriptor().toolId())
                    .setRepositoryVersion(detail.descriptor().version())
                    .setEditable(false)
                    .setOwner(detail.descriptor().owner())
                    .setDescription(detail.descriptor().description())
                    .setTags(detail.descriptor().tags())
                    .setScriptDependencies(detail.descriptor().scriptDependencies())
                    .setPluginDependencies(detail.descriptor().pluginDependencies())
                    .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                    .setUpdatedAt(now);
            scriptRepository.save(definition);
            syncConfigTemplates(repositoryId, detail.descriptor().toolId(), detail.descriptor().version(), detail.configTemplate());
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
        } finally {
            visiting.remove(installationKey);
        }
    }

    private CapabilityPackageInstallResult installOrUpdateCapabilityPackage(String repositoryId,
                                                                            String packageId,
                                                                            boolean updateOnly,
                                                                            LinkedHashSet<String> visiting) {
        String installationId = capabilityPackageInstallationId(repositoryId, packageId);
        if (!visiting.add(installationId)) {
            throw new IllegalStateException("检测到能力包循环依赖: " + String.join(" -> ", visiting) + " -> " + installationId);
        }
        try {
            CapabilityPackageDetail detail = getCapabilityPackage(repositoryId, packageId);
            CapabilityPackageInstallation existing = capabilityPackageInstallationRepository
                    .findByInstallationId(installationId)
                    .orElse(null);
            if (updateOnly && existing == null) {
                throw new IllegalArgumentException("能力包尚未安装: " + packageId);
            }

            for (RepositoryAiPackageDependency dependency : detail.releaseFile().externalDependencies() == null
                    ? List.<RepositoryAiPackageDependency>of()
                    : detail.releaseFile().externalDependencies()) {
                if ("AI_PACKAGE".equalsIgnoreCase(dependency.assetType())) {
                    String dependencyInstallationId = capabilityPackageInstallationId(dependency.repositoryId(), dependency.assetId());
                    if (capabilityPackageInstallationRepository.findByInstallationId(dependencyInstallationId).isPresent()) {
                        installOrUpdateCapabilityPackage(dependency.repositoryId(), dependency.assetId(), true, visiting);
                    } else {
                        installOrUpdateCapabilityPackage(dependency.repositoryId(), dependency.assetId(), false, visiting);
                    }
                    continue;
                }
                if ("TOOL".equalsIgnoreCase(dependency.assetType())) {
                    String installedScriptId = dependency.repositoryId() + "." + dependency.assetId();
                    if (scriptRepository.findById(installedScriptId).isPresent()) {
                        updateTool(dependency.repositoryId(), dependency.assetId(), false, false, false);
                    } else {
                        installTool(dependency.repositoryId(), dependency.assetId(), false, false, false);
                    }
                    continue;
                }
                if ("PLUGIN".equalsIgnoreCase(dependency.assetType())) {
                    PluginRegistration registration = null;
                    try {
                        registration = pluginRuntimeService.getRegistration(dependency.assetId());
                    } catch (RuntimeException ignored) {
                    }
                    if (registration == null) {
                        if (dependency.repositoryId() == null || dependency.repositoryId().isBlank()) {
                            throw new IllegalArgumentException("缺少插件仓库来源，且本地未安装插件: " + dependency.assetId());
                        }
                        installPlugin(dependency.repositoryId(), dependency.assetId(), false);
                    } else if (dependency.repositoryId() != null
                            && !dependency.repositoryId().isBlank()
                            && (!Objects.equals(registration.getRepositoryId(), dependency.repositoryId())
                            || !Objects.equals(registration.getRepositoryPluginId(), dependency.assetId()))) {
                        installPlugin(dependency.repositoryId(), dependency.assetId(), false);
                    }
                    continue;
                }
                throw new IllegalArgumentException("不支持的能力包依赖类型: " + dependency.assetType());
            }

            if (existing != null) {
                uninstallManagedCapabilityPackageAssets(existing);
                for (String presetId : existing.getPresetIds()) {
                    executionPresetRepository.deleteById(presetId);
                }
                removeManagedConfigTemplates(existing.getRepositoryId(), existing.getPackageId());
            }

            CapabilityPackageReleaseFile release = detail.releaseFile();
            Map<String, String> modelIdMappings = new LinkedHashMap<>();
            Map<String, String> toolsetIdMappings = new LinkedHashMap<>();
            Map<String, String> agentIdMappings = new LinkedHashMap<>();
            Map<String, String> scriptIdMappings = new LinkedHashMap<>();
            for (AiPackageModelFile model : safeModels(release)) {
                modelIdMappings.put(model.id(), aiPackageInternalId(repositoryId, packageId, "model", model.id()));
            }
            for (AiPackageToolsetFile toolset : safeToolsets(release)) {
                toolsetIdMappings.put(toolset.id(), aiPackageInternalId(repositoryId, packageId, "toolset", toolset.id()));
            }
            for (AiPackageAgentFile agent : safeAgents(release)) {
                agentIdMappings.put(agent.id(), aiPackageInternalId(repositoryId, packageId, "agent", agent.id()));
            }
            for (AiPackageScriptFile script : safeScripts(release)) {
                scriptIdMappings.put(script.id(), aiPackageInternalId(repositoryId, packageId, "script", script.id()));
            }

            LocalDateTime now = LocalDateTime.now();
            List<String> installedModelIds = new ArrayList<>();
            for (AiPackageModelFile model : safeModels(release)) {
                AiModelProfile profile = new AiModelProfile()
                        .setId(modelIdMappings.get(model.id()))
                        .setName(model.name())
                        .setProvider(model.provider() == null ? AiProvider.AGENTSCOPE : AiProvider.valueOf(model.provider()))
                        .setModelProvider(model.modelProvider() == null ? null : AiModelProvider.valueOf(model.modelProvider()))
                        .setModelName(model.modelName())
                        .setBaseUrl(model.baseUrl())
                        .setApiKeyConfigKey(model.apiKeyConfigKey())
                        .setDefaultOptions(model.defaultOptions() == null ? Map.of() : model.defaultOptions())
                        .setLimits(model.limits() == null ? Map.of() : model.limits())
                        .setCapabilities(readCapabilities(model.capabilities()))
                        .setEnabled(model.enabled())
                        .setCreatedAt(now)
                        .setUpdatedAt(now);
                aiModelProfileRepository.save(profile);
                installedModelIds.add(profile.getId());
            }

            List<String> installedToolsetIds = new ArrayList<>();
            for (AiPackageToolsetFile toolset : safeToolsets(release)) {
                List<String> toolNames = toolset.toolNames() == null ? List.of() : toolset.toolNames().stream()
                        .map(toolName -> rewriteToolName(toolName, agentIdMappings, scriptIdMappings))
                        .toList();
                AiToolset value = new AiToolset()
                        .setId(toolsetIdMappings.get(toolset.id()))
                        .setName(toolset.name())
                        .setDescription(toolset.description())
                        .setToolNames(toolNames)
                        .setToolOptions(rewriteToolOptions(toolset.toolOptions(), agentIdMappings, scriptIdMappings))
                        .setMaxPermission(toolset.maxPermission() == null
                                ? AiToolPermission.READ_ONLY
                                : AiToolPermission.valueOf(toolset.maxPermission()))
                        .setEnabled(toolset.enabled())
                        .setCreatedAt(now)
                        .setUpdatedAt(now);
                aiToolsetRepository.save(value);
                installedToolsetIds.add(value.getId());
            }

            List<String> installedScriptIds = new ArrayList<>();
            for (AiPackageScriptFile script : safeScripts(release)) {
                String runtimeScriptId = scriptIdMappings.get(script.id());
                ScriptDefinition definition = new ScriptDefinition()
                        .setId(runtimeScriptId)
                        .setName(script.name())
                        .setType(script.type() == null ? ScriptType.GROOVY : ScriptType.valueOf(script.type()))
                        .setPackaging(script.packaging() == null ? ScriptPackaging.TOOL : ScriptPackaging.valueOf(script.packaging()))
                        .setSource(rewriteScriptSource(script.source(), scriptIdMappings, modelIdMappings, agentIdMappings))
                        .setPythonRequirements(script.pythonRequirements())
                        .setInputSchema(script.inputSchema() == null ? Map.of() : script.inputSchema())
                        .setOutputSchema(script.outputSchema() == null ? Map.of() : script.outputSchema())
                        .setStatus(ScriptStatus.PUBLISHED)
                        .setPublishedSnapshot(new PublishedScriptSnapshot()
                                .setName(script.name())
                                .setType(script.type() == null ? ScriptType.GROOVY : ScriptType.valueOf(script.type()))
                                .setPackaging(script.packaging() == null ? ScriptPackaging.TOOL : ScriptPackaging.valueOf(script.packaging()))
                                .setSource(rewriteScriptSource(script.source(), scriptIdMappings, modelIdMappings, agentIdMappings))
                                .setPythonRequirements(script.pythonRequirements())
                                .setInputSchema(script.inputSchema() == null ? Map.of() : script.inputSchema())
                                .setOutputSchema(script.outputSchema() == null ? Map.of() : script.outputSchema())
                                .setAiDependencies(rewriteAiDependencies(script.aiDependencies(), modelIdMappings, agentIdMappings)))
                        .setVersion(1)
                        .setEditable(false)
                        .setDescription(script.description())
                        .setTags(script.tags())
                        .setPluginDependencies(script.pluginDependencies())
                        .setAiDependencies(rewriteAiDependencies(script.aiDependencies(), modelIdMappings, agentIdMappings))
                        .setCreatedAt(now)
                        .setUpdatedAt(now);
                scriptRepository.save(definition);
                installedScriptIds.add(runtimeScriptId);
            }

            List<String> installedAgentIds = new ArrayList<>();
            for (AiPackageAgentFile agent : safeAgents(release)) {
                String runtimeAgentId = agentIdMappings.get(agent.id());
                AiAgentProfile profile = new AiAgentProfile()
                        .setId(runtimeAgentId)
                        .setName(agent.name())
                        .setDescription(agent.description())
                        .setProvider(agent.provider() == null ? AiProvider.AGENTSCOPE : AiProvider.valueOf(agent.provider()))
                        .setModelProfileId(modelIdMappings.getOrDefault(agent.modelProfileId(), agent.modelProfileId()))
                        .setSystemPrompt(agent.systemPrompt())
                        .setToolsetIds(agent.toolsetIds() == null ? List.of() : agent.toolsetIds().stream()
                                .map(toolsetId -> toolsetIdMappings.getOrDefault(toolsetId, toolsetId))
                                .toList())
                        .setDirectToolNames(agent.directToolNames() == null ? List.of() : agent.directToolNames().stream()
                                .map(toolName -> rewriteToolName(toolName, agentIdMappings, scriptIdMappings))
                                .toList())
                        .setDirectToolOptions(rewriteToolOptions(agent.directToolOptions(), agentIdMappings, scriptIdMappings))
                        .setSkillIds(agent.skillIds() == null ? List.of() : agent.skillIds())
                        .setOptions(agent.options() == null ? Map.of() : agent.options())
                        .setEnabled(agent.enabled())
                        .setCreatedAt(now)
                        .setUpdatedAt(now);
                aiAgentProfileRepository.save(profile);
                installedAgentIds.add(runtimeAgentId);
            }

            List<String> installedScheduleIds = new ArrayList<>();
            for (ScheduleTemplateItem template : detail.scheduleTemplate()) {
                String runtimeScriptId = scriptIdMappings.get(template.scriptId());
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
                        .setRepositoryId(repositoryId)
                        .setRepositoryToolId(runtimeScriptId)
                        .setRepositoryPackageId(packageId)
                        .setRepositoryVersion(detail.descriptor().version())
                        .setCreatedAt(now)
                        .setUpdatedAt(now);
                scriptScheduleRepository.save(schedule);
                installedScheduleIds.add(schedule.getId());
            }

            List<String> installedPresetIds = new ArrayList<>();
            for (CapabilityPackagePresetTemplate template : detail.presetTemplate()) {
                String runtimeScriptId = scriptIdMappings.get(template.scriptId());
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
                        .setRepositoryId(repositoryId)
                        .setRepositoryPackageId(packageId)
                        .setRepositoryVersion(detail.descriptor().version())
                        .setCreatedAt(now)
                        .setUpdatedAt(now);
                executionPresetRepository.save(preset);
                installedPresetIds.add(preset.getId());
            }

            syncConfigTemplates(repositoryId, packageId, detail.descriptor().version(), detail.configTemplate());
            String runtimeEntryId = resolveCapabilityPackageRuntimeEntry(detail.releaseFile().entries(), agentIdMappings, scriptIdMappings);
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
                    .setModelIds(installedModelIds)
                    .setToolsetIds(installedToolsetIds)
                    .setAgentIds(installedAgentIds)
                    .setScriptIds(installedScriptIds)
                    .setScheduleIds(installedScheduleIds)
                    .setPresetIds(installedPresetIds)
                    .setInstalledAt(existing == null ? now : Optional.ofNullable(existing.getInstalledAt()).orElse(now))
                    .setUpdatedAt(now);
            return new CapabilityPackageInstallResult(
                    capabilityPackageInstallationRepository.save(installation),
                    release.externalDependencies() == null ? List.of() : release.externalDependencies()
            );
        } finally {
            visiting.remove(installationId);
        }
    }

    AiPackageBundle buildAiPackageBundle(RepositoryDefinition repository,
                                         String entryAgentId,
                                         String packageId) {
        AiPackageBundleBuilder builder = new AiPackageBundleBuilder(repository, packageId, entryAgentId);
        collectAgentDependency(repository, builder, entryAgentId, true);
        return builder.build();
    }

    private void collectAgentDependency(RepositoryDefinition repository,
                                        AiPackageBundleBuilder builder,
                                        String agentId,
                                        boolean entryPoint) {
        if (builder.hasAgent(agentId) || builder.isExternalAgent(agentId)) {
            return;
        }
        CapabilityPackageInstallation packageInstallation = capabilityPackageInstallationRepository
                .findByEntryAgentId(agentId)
                .orElse(null);
        if (packageInstallation != null) {
            builder.addExternalDependency(new RepositoryAiPackageDependency(
                    "AI_PACKAGE",
                    packageInstallation.getRepositoryId(),
                    packageInstallation.getPackageId(),
                    packageInstallation.getVersion()
            ));
            return;
        }
        if (agentId.startsWith(AI_PACKAGE_INTERNAL_PREFIX)) {
            throw new IllegalArgumentException("不能将已安装 AI 能力包的内部 Agent 作为发布依赖: " + agentId);
        }
        AiAgentProfile profile = aiAgentProfileRepository.findById(agentId)
                .orElseThrow(() -> new IllegalArgumentException("AI Agent Profile 不存在: " + agentId));
        builder.addAgent(entryPoint ? builder.entryAgentId() : profile.getId(), toAiPackageAgentFile(profile));
        collectModelDependency(builder, profile.getModelProfileId());
        for (String toolsetId : profile.getToolsetIds()) {
            collectToolsetDependency(repository, builder, toolsetId);
        }
        for (String toolName : profile.getDirectToolNames()) {
            collectToolNameDependency(repository, builder, toolName);
        }
    }

    private void collectModelDependency(AiPackageBundleBuilder builder, String modelProfileId) {
        if (modelProfileId == null || modelProfileId.isBlank() || builder.hasModel(modelProfileId)) {
            return;
        }
        if (modelProfileId.startsWith(AI_PACKAGE_INTERNAL_PREFIX)) {
            throw new IllegalArgumentException("不能将已安装 AI 能力包的内部模型作为发布依赖: " + modelProfileId);
        }
        AiModelProfile profile = aiModelProfileRepository.findById(modelProfileId)
                .orElseThrow(() -> new IllegalArgumentException("AI 模型 Profile 不存在: " + modelProfileId));
        builder.addModel(profile.getId(), toAiPackageModelFile(profile));
    }

    private void collectToolsetDependency(RepositoryDefinition repository,
                                          AiPackageBundleBuilder builder,
                                          String toolsetId) {
        if (toolsetId == null || toolsetId.isBlank() || builder.hasToolset(toolsetId)) {
            return;
        }
        if (toolsetId.startsWith(AI_PACKAGE_INTERNAL_PREFIX)) {
            throw new IllegalArgumentException("不能将已安装 AI 能力包的内部工具集作为发布依赖: " + toolsetId);
        }
        AiToolset toolset = aiToolsetRepository.findById(toolsetId)
                .orElseThrow(() -> new IllegalArgumentException("AI 工具集不存在: " + toolsetId));
        builder.addToolset(toolset.getId(), toAiPackageToolsetFile(toolset));
        for (String toolName : toolset.getToolNames()) {
            collectToolNameDependency(repository, builder, toolName);
        }
    }

    private void collectToolNameDependency(RepositoryDefinition repository,
                                           AiPackageBundleBuilder builder,
                                           String toolName) {
        if (toolName == null || toolName.isBlank()) {
            return;
        }
        if (toolName.startsWith("script.")) {
            collectScriptDependency(repository, builder, toolName.substring("script.".length()));
            return;
        }
        if (toolName.startsWith("agent.")) {
            collectAgentDependency(repository, builder, toolName.substring("agent.".length()), false);
        }
    }

    private void collectScriptDependency(RepositoryDefinition repository,
                                         AiPackageBundleBuilder builder,
                                         String scriptId) {
        if (scriptId == null || scriptId.isBlank() || builder.hasScript(scriptId) || builder.isExternalScript(scriptId)) {
            return;
        }
        ScriptDefinition script = scriptRepository.findById(scriptId)
                .orElseThrow(() -> new IllegalArgumentException("脚本不存在: " + scriptId));
        if (scriptId.startsWith(AI_PACKAGE_INTERNAL_PREFIX)) {
            throw new IllegalArgumentException("不能将已安装 AI 能力包的内部脚本作为发布依赖: " + scriptId);
        }
        if (script.getScope() == ScriptScope.REPOSITORY || script.getScope() == ScriptScope.DEVELOPMENT) {
            String sourceRepositoryId = normalizeNullable(script.getRepositoryId());
            String sourceToolId = normalizeNullable(script.getRepositoryToolId());
            String sourceVersion = normalizeNullable(script.getRepositoryVersion());
            if (sourceRepositoryId != null && sourceToolId != null && sourceVersion != null) {
                builder.addExternalDependency(new RepositoryAiPackageDependency(
                        "TOOL",
                        sourceRepositoryId,
                        sourceToolId,
                        sourceVersion
                ));
                return;
            }
        }
        ScriptDefinition published = scriptApplicationService.getPublished(scriptId);
        PublishedScriptSnapshot snapshot = published.getPublishedSnapshot();
        String source = snapshot == null ? published.getSource() : snapshot.getSource();
        builder.addScript(published.getId(), toAiPackageScriptFile(published));
        for (PluginDependency dependency : published.getPluginDependencies() == null ? List.<PluginDependency>of() : published.getPluginDependencies()) {
            collectPluginDependency(builder, dependency);
        }
        for (String nestedScriptId : extractScriptDependenciesFromSource(source)) {
            collectScriptDependency(repository, builder, nestedScriptId);
        }
        for (AiDependency dependency : snapshot == null ? published.getAiDependencies() : snapshot.getAiDependencies()) {
            if (dependency.getProfile() != null && !dependency.getProfile().isBlank()) {
                collectModelDependency(builder, dependency.getProfile());
            }
            if (dependency.getAgentProfile() != null && !dependency.getAgentProfile().isBlank()) {
                collectAgentDependency(repository, builder, dependency.getAgentProfile(), false);
            }
        }
    }

    private void collectPluginDependency(AiPackageBundleBuilder builder, PluginDependency dependency) {
        if (dependency == null || dependency.getPluginId() == null || dependency.getPluginId().isBlank()) {
            return;
        }
        PluginRegistration registration = null;
        try {
            registration = pluginRuntimeService.getRegistration(dependency.getPluginId());
        } catch (RuntimeException ignored) {
        }
        String repositoryId = registration == null ? null : normalizeNullable(registration.getRepositoryId());
        String assetId = registration == null
                ? dependency.getPluginId()
                : normalizeOrDefault(registration.getRepositoryPluginId(), dependency.getPluginId());
        String version = normalizeNullable(registration == null ? null : registration.getRepositoryVersion());
        if (version == null) {
            version = normalizeNullable(dependency.getVersionRange());
        }
        if (version == null && registration != null) {
            version = normalizeNullable(registration.getVersion());
        }
        builder.addExternalDependency(new RepositoryAiPackageDependency(
                "PLUGIN",
                repositoryId == null ? "" : repositoryId,
                assetId,
                version == null ? "" : version
        ));
    }

    List<ConfigTemplateItem> buildAiPackageConfigTemplate(AiPackageBundle bundle) {
        Map<String, ConfigTemplateItem> templates = new LinkedHashMap<>();
        for (AiPackageModelFile model : bundle.models().values()) {
            if (model.apiKeyConfigKey() == null || model.apiKeyConfigKey().isBlank()) {
                continue;
            }
            templates.putIfAbsent(model.apiKeyConfigKey(), new ConfigTemplateItem(
                    model.apiKeyConfigKey(),
                    "模型密钥: " + model.name(),
                    "string",
                    false,
                    true,
                    null
            ));
        }
        for (AiPackageScriptFile script : bundle.scripts().values()) {
            RepositoryPublishConfigResolver.PublishConfigResolution resolution = RepositoryPublishConfigResolver.resolve(
                    script.source(),
                    List.of(),
                    configValueRepository.findAll()
            );
            for (ConfigTemplateItem item : RepositoryPublishConfigResolver.buildTemplates(
                    resolution,
                    resolution.inferredKeys().stream()
                            .map(key -> new RepositoryPublishConfigItem(key, "PLACEHOLDER"))
                            .toList()
            )) {
                templates.putIfAbsent(item.key(), item);
            }
        }
        return templates.values().stream()
                .sorted(Comparator.comparing(ConfigTemplateItem::key))
                .toList();
    }

    private CapabilityPackageDraft buildCapabilityPackageDraft(RepositoryDefinition repository,
                                                               CapabilityPackagePublishPreviewRequest request) {
        return buildCapabilityPackageDraft(
                repository,
                request == null ? null : request.packageId(),
                request == null ? null : request.displayName(),
                request == null ? null : request.version(),
                request == null ? null : request.owner(),
                request == null ? null : request.description(),
                request == null ? null : request.releaseNotes(),
                request == null ? null : request.tags(),
                request == null ? null : request.riskLevel(),
                request == null ? null : request.source(),
                request == null ? null : request.primaryEntry(),
                request == null ? null : request.scriptIds(),
                request == null ? null : request.agentIds(),
                request == null ? null : request.modelIds(),
                request == null ? null : request.toolsetIds()
        );
    }

    private CapabilityPackageDraft buildCapabilityPackageDraft(RepositoryDefinition repository,
                                                               CapabilityPackagePublishRequest request) {
        return buildCapabilityPackageDraft(
                repository,
                request == null ? null : request.packageId(),
                request == null ? null : request.displayName(),
                request == null ? null : request.version(),
                request == null ? null : request.owner(),
                request == null ? null : request.description(),
                request == null ? null : request.releaseNotes(),
                request == null ? null : request.tags(),
                request == null ? null : request.riskLevel(),
                request == null ? null : request.source(),
                request == null ? null : request.primaryEntry(),
                request == null ? null : request.scriptIds(),
                request == null ? null : request.agentIds(),
                request == null ? null : request.modelIds(),
                request == null ? null : request.toolsetIds()
        );
    }

    private CapabilityPackageDraft buildCapabilityPackageDraft(RepositoryDefinition repository,
                                                               String packageIdValue,
                                                               String displayNameValue,
                                                               String versionValue,
                                                               String owner,
                                                               String descriptionValue,
                                                               String releaseNotes,
                                                               List<String> tags,
                                                               String riskLevel,
                                                               CapabilityPackageSource source,
                                                               CapabilityPackageEntrySelection primaryEntry,
                                                               List<String> scriptIds,
                                                               List<String> agentIds,
                                                               List<String> modelIds,
                                                               List<String> toolsetIds) {
        String packageId = normalize(packageIdValue, "packageId 不能为空");
        String version = normalize(versionValue, "version 不能为空");
        CapabilityPackageSource sourceType = source == null ? CapabilityPackageSource.MANUAL : source;
        CapabilityPackageEntrySelection entry = primaryEntry;
        if (entry == null) {
            throw new IllegalArgumentException("primaryEntry 不能为空");
        }
        String entryType = normalize(entry.type(), "entry.type 不能为空").toUpperCase(Locale.ROOT);
        String entryTargetId = normalize(entry.targetId(), "entry.targetId 不能为空");
        String builderEntryAgentId = "AGENT".equals(entryType) ? entryTargetId : packageId + ".entry";
        AiPackageBundleBuilder builder = new AiPackageBundleBuilder(repository, packageId, builderEntryAgentId);

        if ("AGENT".equals(entryType)) {
            collectAgentDependency(repository, builder, entryTargetId, true);
        } else if ("SCRIPT".equals(entryType)) {
            collectScriptDependency(repository, builder, entryTargetId);
        } else {
            throw new IllegalArgumentException("当前仅支持 AGENT / SCRIPT 入口");
        }
        for (String scriptId : scriptIds == null ? List.<String>of() : scriptIds) {
            collectScriptDependency(repository, builder, normalize(scriptId, "scriptId 不能为空"));
        }
        for (String agentId : agentIds == null ? List.<String>of() : agentIds) {
            collectAgentDependency(repository, builder, normalize(agentId, "agentId 不能为空"), false);
        }
        for (String modelId : modelIds == null ? List.<String>of() : modelIds) {
            collectModelDependency(builder, normalize(modelId, "modelId 不能为空"));
        }
        for (String toolsetId : toolsetIds == null ? List.<String>of() : toolsetIds) {
            collectToolsetDependency(repository, builder, normalize(toolsetId, "toolsetId 不能为空"));
        }

        AiPackageBundle bundle = builder.build();
        List<ConfigTemplateItem> configTemplate = buildAiPackageConfigTemplate(bundle);
        List<ScheduleTemplateItem> scheduleTemplate = buildCapabilityPackageScheduleTemplate(bundle);
        List<CapabilityPackagePresetTemplate> presetTemplate = buildCapabilityPackagePresetTemplate(bundle);
        List<CapabilityPackageEntryFile> entries = buildCapabilityPackageEntries(entry, bundle, scriptIds, agentIds);
        String displayName = normalizeOrDefault(displayNameValue, resolveCapabilityPackageDisplayName(entry, bundle));
        String description = normalizeNullable(descriptionValue == null ? resolveCapabilityPackageDescription(entry, bundle) : descriptionValue);
        return new CapabilityPackageDraft(
                packageId,
                displayName,
                version,
                normalizeNullable(owner),
                description,
                normalizeNullable(releaseNotes),
                tags == null ? List.of() : tags.stream().map(this::normalizeNullable).filter(Objects::nonNull).distinct().toList(),
                normalizeNullable(riskLevel),
                sourceType,
                entries,
                bundle,
                configTemplate,
                scheduleTemplate,
                presetTemplate
        );
    }

    private List<CapabilityPackageEntryFile> buildCapabilityPackageEntries(CapabilityPackageEntrySelection primaryEntry,
                                                                           AiPackageBundle bundle,
                                                                           List<String> scriptIds,
                                                                           List<String> agentIds) {
        LinkedHashMap<String, CapabilityPackageEntryFile> entries = new LinkedHashMap<>();
        addCapabilityPackageEntry(entries, primaryEntry);
        for (String scriptId : scriptIds == null ? List.<String>of() : scriptIds) {
            ScriptDefinition script = scriptRepository.findById(scriptId).orElse(null);
            if (script != null) {
                entries.putIfAbsent("SCRIPT:" + scriptId, new CapabilityPackageEntryFile(
                        "SCRIPT",
                        scriptId,
                        script.getName(),
                        "script:" + scriptId
                ));
            }
        }
        for (String agentId : agentIds == null ? List.<String>of() : agentIds) {
            AiAgentProfile agent = aiAgentProfileRepository.findById(agentId).orElse(null);
            if (agent != null) {
                entries.putIfAbsent("AGENT:" + agentId, new CapabilityPackageEntryFile(
                        "AGENT",
                        agentId,
                        agent.getName(),
                        "agent:" + agentId
                ));
            }
        }
        if (entries.isEmpty()) {
            if (!bundle.agents().isEmpty()) {
                AiPackageAgentFile agent = bundle.agents().values().iterator().next();
                entries.put("AGENT:" + agent.id(), new CapabilityPackageEntryFile("AGENT", agent.id(), agent.name(), "agent:" + agent.id()));
            } else if (!bundle.scripts().isEmpty()) {
                AiPackageScriptFile script = bundle.scripts().values().iterator().next();
                entries.put("SCRIPT:" + script.id(), new CapabilityPackageEntryFile("SCRIPT", script.id(), script.name(), "script:" + script.id()));
            }
        }
        return new ArrayList<>(entries.values());
    }

    private void addCapabilityPackageEntry(Map<String, CapabilityPackageEntryFile> entries,
                                           CapabilityPackageEntrySelection selection) {
        if (selection == null) {
            return;
        }
        String type = normalize(selection.type(), "entry.type 不能为空").toUpperCase(Locale.ROOT);
        String targetId = normalize(selection.targetId(), "entry.targetId 不能为空");
        String displayName = normalizeNullable(selection.displayName());
        if ("AGENT".equals(type)) {
            AiAgentProfile agent = aiAgentProfileRepository.findById(targetId)
                    .orElseThrow(() -> new IllegalArgumentException("AI Agent Profile 不存在: " + targetId));
            entries.put(type + ":" + targetId, new CapabilityPackageEntryFile(type, targetId, normalizeOrDefault(displayName, agent.getName()), "agent:" + targetId));
            return;
        }
        if ("SCRIPT".equals(type)) {
            ScriptDefinition script = scriptRepository.findById(targetId)
                    .orElseThrow(() -> new IllegalArgumentException("脚本不存在: " + targetId));
            entries.put(type + ":" + targetId, new CapabilityPackageEntryFile(type, targetId, normalizeOrDefault(displayName, script.getName()), "script:" + targetId));
            return;
        }
        throw new IllegalArgumentException("当前仅支持 AGENT / SCRIPT 入口");
    }

    private String resolveCapabilityPackageDisplayName(CapabilityPackageEntrySelection entry, AiPackageBundle bundle) {
        if (entry != null && entry.displayName() != null && !entry.displayName().isBlank()) {
            return entry.displayName().trim();
        }
        if (entry != null && "AGENT".equalsIgnoreCase(entry.type())) {
            return normalizeOrDefault(bundle.entryAgentName(), entry.targetId());
        }
        if (entry != null && "SCRIPT".equalsIgnoreCase(entry.type())) {
            ScriptDefinition script = scriptRepository.findById(entry.targetId()).orElse(null);
            if (script != null) {
                return script.getName();
            }
        }
        return normalizeOrDefault(bundle.entryAgentName(), "Capability Package");
    }

    private String resolveCapabilityPackageDescription(CapabilityPackageEntrySelection entry, AiPackageBundle bundle) {
        if (entry != null && "AGENT".equalsIgnoreCase(entry.type())) {
            return normalizeNullable(bundle.entryAgentDescription());
        }
        if (entry != null && "SCRIPT".equalsIgnoreCase(entry.type())) {
            ScriptDefinition script = scriptRepository.findById(entry.targetId()).orElse(null);
            return script == null ? null : normalizeNullable(script.getDescription());
        }
        return normalizeNullable(bundle.entryAgentDescription());
    }

    private List<ScheduleTemplateItem> buildCapabilityPackageScheduleTemplate(AiPackageBundle bundle) {
        List<ScheduleTemplateItem> templates = new ArrayList<>();
        for (String scriptId : bundle.scripts().keySet()) {
            for (ScriptSchedule schedule : scriptScheduleRepository.findByScriptId(scriptId)) {
                templates.add(new ScheduleTemplateItem(
                        schedule.getId(),
                        schedule.getScriptId(),
                        schedule.getName(),
                        schedule.getCronExpression(),
                        schedule.getInput(),
                        schedule.isEnabled()
                ));
            }
        }
        return templates.stream()
                .sorted(Comparator.comparing(ScheduleTemplateItem::name))
                .toList();
    }

    private List<CapabilityPackagePresetTemplate> buildCapabilityPackagePresetTemplate(AiPackageBundle bundle) {
        List<CapabilityPackagePresetTemplate> templates = new ArrayList<>();
        for (String scriptId : bundle.scripts().keySet()) {
            for (ExecutionPreset preset : executionPresetRepository.findByScriptId(scriptId)) {
                templates.add(new CapabilityPackagePresetTemplate(
                        preset.getId(),
                        scriptId,
                        preset.getName(),
                        preset.getInput()
                ));
            }
        }
        return templates.stream()
                .sorted(Comparator.comparing(CapabilityPackagePresetTemplate::name))
                .toList();
    }

    private CapabilityPackagePublishPreview buildCapabilityPackagePublishPreview(RepositoryDefinition repository,
                                                                                CapabilityPackageDraft draft) {
        CapabilityPackageDetail currentPackage = null;
        try {
            currentPackage = getCapabilityPackage(repository.getId(), draft.packageId());
        } catch (IllegalArgumentException ignored) {
        }
        List<CapabilityPackageCheck> checks = new ArrayList<>();
        if (draft.entries().isEmpty()) {
            checks.add(new CapabilityPackageCheck("BLOCKER", "ENTRY_MISSING", "缺少主入口"));
        }
        if (draft.releaseNotes() == null || draft.releaseNotes().isBlank()) {
            checks.add(new CapabilityPackageCheck("WARNING", "RELEASE_NOTES_EMPTY", "未填写 release notes"));
        }
        for (RepositoryAiPackageDependency dependency : draft.bundle().externalDependencies().values()) {
            if ((dependency.version() == null || dependency.version().isBlank())
                    && !"AI_PACKAGE".equalsIgnoreCase(dependency.assetType())) {
                checks.add(new CapabilityPackageCheck("BLOCKER", "DEPENDENCY_VERSION_MISSING", "存在未声明版本的外部依赖: " + dependency.assetId()));
            } else if ("PLUGIN".equalsIgnoreCase(dependency.assetType())
                    && (dependency.repositoryId() == null || dependency.repositoryId().isBlank())) {
                checks.add(new CapabilityPackageCheck("WARNING", "PLUGIN_EXTERNAL_ONLY", "插件依赖缺少仓库来源，安装时需要本地已存在: " + dependency.assetId()));
            }
        }
        checks.add(new CapabilityPackageCheck("INFO", "ASSET_SUMMARY",
                "包含 " + draft.bundle().scripts().size() + " 个脚本 / " + draft.bundle().agents().size() + " 个 Agent / "
                        + draft.bundle().toolsets().size() + " 个工具集 / " + draft.bundle().models().size() + " 个模型"));

        List<String> currentEntryKeys = currentPackage == null
                ? List.of()
                : currentPackage.releaseFile().entries().stream().map(item -> item.type() + ":" + item.id()).toList();
        List<String> nextEntryKeys = draft.entries().stream().map(item -> item.type() + ":" + item.id()).toList();
        List<String> addedEntries = nextEntryKeys.stream().filter(item -> !currentEntryKeys.contains(item)).toList();
        List<String> removedEntries = currentEntryKeys.stream().filter(item -> !nextEntryKeys.contains(item)).toList();
        List<String> changedAssets = new ArrayList<>();
        if (currentPackage == null || !Objects.equals(currentPackage.releaseFile().scripts().stream().map(AiPackageScriptFile::id).sorted().toList(),
                draft.bundle().scripts().keySet().stream().sorted().toList())) {
            changedAssets.add("scripts");
        }
        if (currentPackage == null || !Objects.equals(currentPackage.releaseFile().agents().stream().map(AiPackageAgentFile::id).sorted().toList(),
                draft.bundle().agents().keySet().stream().sorted().toList())) {
            changedAssets.add("agents");
        }
        if (currentPackage == null || !Objects.equals(currentPackage.releaseFile().toolsets().stream().map(AiPackageToolsetFile::id).sorted().toList(),
                draft.bundle().toolsets().keySet().stream().sorted().toList())) {
            changedAssets.add("toolsets");
        }
        if (currentPackage == null || !Objects.equals(currentPackage.releaseFile().models().stream().map(AiPackageModelFile::id).sorted().toList(),
                draft.bundle().models().keySet().stream().sorted().toList())) {
            changedAssets.add("models");
        }

        return new CapabilityPackagePublishPreview(
                draft.packageId(),
                draft.version(),
                draft.entries(),
                draft.bundle().models().keySet().stream().sorted().toList(),
                draft.bundle().toolsets().keySet().stream().sorted().toList(),
                draft.bundle().agents().keySet().stream().sorted().toList(),
                draft.bundle().scripts().keySet().stream().sorted().toList(),
                draft.configTemplate(),
                draft.scheduleTemplate(),
                draft.presetTemplate(),
                draft.bundle().externalDependencies().values().stream().toList(),
                checks,
                new CapabilityPackageDiffSummary(
                        currentPackage == null ? "INITIAL" : "COMPARE",
                        addedEntries,
                        removedEntries,
                        changedAssets
                )
        );
    }

    private void writeCapabilityPackageFiles(Path packageRoot,
                                             CapabilityPackageDraft draft,
                                             CapabilityPackagePublishPreview preview) {
        try {
            Path versionsDir = packageRoot.resolve("versions").resolve(draft.version());
            Files.createDirectories(versionsDir);
            if (!draft.configTemplate().isEmpty()) {
                writeJson(versionsDir.resolve("config.template.json"), draft.configTemplate());
            }
            if (!draft.scheduleTemplate().isEmpty()) {
                writeJson(versionsDir.resolve("schedules.template.json"), draft.scheduleTemplate());
            }
            if (!draft.presetTemplate().isEmpty()) {
                writeJson(versionsDir.resolve("presets.template.json"), draft.presetTemplate());
            }
            String latestReleasePath = CAPABILITY_PACKAGES_DIR + "/" + draft.packageId() + "/versions/" + draft.version() + "/" + CAPABILITY_PACKAGE_RELEASE_FILE;
            writeJson(versionsDir.resolve(CAPABILITY_PACKAGE_RELEASE_FILE), new CapabilityPackageReleaseFile(
                    1,
                    draft.packageId(),
                    draft.displayName(),
                    draft.version(),
                    draft.description(),
                    draft.releaseNotes(),
                    draft.owner(),
                    draft.tags(),
                    draft.riskLevel(),
                    draft.source().name(),
                    draft.entries(),
                    new ArrayList<>(draft.bundle().models().values()),
                    new ArrayList<>(draft.bundle().toolsets().values()),
                    new ArrayList<>(draft.bundle().agents().values()),
                    new ArrayList<>(draft.bundle().scripts().values()),
                    draft.bundle().externalDependencies().values().stream().toList(),
                    draft.configTemplate().isEmpty() ? null : "config.template.json",
                    draft.scheduleTemplate().isEmpty() ? null : "schedules.template.json",
                    draft.presetTemplate().isEmpty() ? null : "presets.template.json"
            ));
            writeJson(packageRoot.resolve(CAPABILITY_PACKAGE_MANIFEST_FILE), new CapabilityPackageManifestFile(
                    1,
                    draft.packageId(),
                    draft.displayName(),
                    draft.version(),
                    draft.description(),
                    draft.releaseNotes(),
                    draft.owner(),
                    draft.tags(),
                    draft.riskLevel(),
                    draft.entries(),
                    latestReleasePath
            ));
        } catch (IOException exception) {
            throw new IllegalStateException("写入能力包文件失败", exception);
        }
    }

    private void updateCapabilityPackageIndex(Path root,
                                              RepositoryDefinition repository,
                                              CapabilityPackageDraft draft,
                                              CapabilityPackagePublishPreview preview) {
        RepositoryIndexFile current = Files.exists(root.resolve(REPOSITORY_INDEX_FILE))
                ? readJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryIndexFile.class)
                : new RepositoryIndexFile(1, repository.getName(), repository.getDescription(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>());
        List<CapabilityPackageIndexEntry> entries = new ArrayList<>(safeCapabilityPackages(current));
        CapabilityPackageIndexEntry next = new CapabilityPackageIndexEntry(
                draft.packageId(),
                draft.displayName(),
                draft.version(),
                draft.description(),
                draft.releaseNotes(),
                CAPABILITY_PACKAGES_DIR + "/" + draft.packageId() + "/" + CAPABILITY_PACKAGE_MANIFEST_FILE
        );
        entries.removeIf(item -> draft.packageId().equals(item.id()));
        entries.add(next);
        entries.sort(Comparator.comparing(CapabilityPackageIndexEntry::id));
        writeJson(root.resolve(REPOSITORY_INDEX_FILE), new RepositoryIndexFile(
                1,
                repository.getName(),
                normalizeNullable(repository.getDescription()),
                new ArrayList<>(safeTools(current)),
                new ArrayList<>(safePlugins(current)),
                entries,
                new ArrayList<>(safeSkills(current))
        ));
    }

    private void updateRepositorySkillIndex(Path root,
                                            RepositoryDefinition repository,
                                            SkillService.SkillValidationResult validation,
                                            String version,
                                            String releaseNotes) {
        RepositoryIndexFile current = Files.exists(root.resolve(REPOSITORY_INDEX_FILE))
                ? readJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryIndexFile.class)
                : new RepositoryIndexFile(1, repository.getName(), repository.getDescription(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>());
        List<RepositorySkillIndexEntry> entries = new ArrayList<>(safeSkills(current));
        RepositorySkillIndexEntry next = new RepositorySkillIndexEntry(
                validation.skillId(),
                normalize(validation.displayName(), "displayName 不能为空"),
                normalize(version, "version 不能为空"),
                normalizeNullable(validation.description()),
                normalizeNullable(releaseNotes),
                SKILLS_DIR + "/" + validation.skillId() + "/" + SKILL_MANIFEST_FILE
        );
        entries.removeIf(item -> validation.skillId().equals(item.id()));
        entries.add(next);
        entries.sort(Comparator.comparing(RepositorySkillIndexEntry::id));
        writeJson(root.resolve(REPOSITORY_INDEX_FILE), new RepositoryIndexFile(
                1,
                repository.getName(),
                normalizeNullable(repository.getDescription()),
                new ArrayList<>(safeTools(current)),
                new ArrayList<>(safePlugins(current)),
                new ArrayList<>(safeCapabilityPackages(current)),
                entries
        ));
    }

    private void uninstallManagedCapabilityPackageAssets(CapabilityPackageInstallation installation) {
        for (String scriptId : installation.getScriptIds()) {
            scriptScheduleRepository.deleteByScriptId(scriptId);
            scriptRepository.deleteById(scriptId);
        }
        for (String agentId : installation.getAgentIds()) {
            aiAgentProfileRepository.deleteById(agentId);
        }
        for (String toolsetId : installation.getToolsetIds()) {
            aiToolsetRepository.deleteById(toolsetId);
        }
        for (String modelId : installation.getModelIds()) {
            aiModelProfileRepository.deleteById(modelId);
        }
    }

    private void removeManagedConfigTemplates(String repositoryId, String packageId) {
        for (ConfigValue configValue : configValueRepository.findAll()) {
            if (configValue.isManaged()
                    && Objects.equals(repositoryId, configValue.getRepositoryId())
                    && Objects.equals(packageId, configValue.getRepositoryToolId())) {
                configValueRepository.deleteByKey(configValue.getKey());
            }
        }
    }

    private String capabilityPackageInstallationId(String repositoryId, String packageId) {
        return normalize(repositoryId, "repositoryId 不能为空") + ":" + normalize(packageId, "packageId 不能为空");
    }

    private String aiPackageEntryAgentRuntimeId(String repositoryId, String packageId) {
        return AI_PACKAGE_ENTRY_PREFIX + normalize(repositoryId, "repositoryId 不能为空") + "." + normalize(packageId, "packageId 不能为空");
    }

    private String aiPackageInternalId(String repositoryId, String packageId, String kind, String localId) {
        return AI_PACKAGE_INTERNAL_PREFIX
                + normalize(repositoryId, "repositoryId 不能为空")
                + "."
                + normalize(packageId, "packageId 不能为空")
                + "."
                + normalize(kind, "kind 不能为空")
                + "."
                + normalize(localId, "localId 不能为空");
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
        values.put("packaging", descriptor.packaging());
        values.put("description", descriptor.description());
        values.put("owner", descriptor.owner());
        values.put("tags", descriptor.tags());
        values.put("scriptDependencies", descriptor.scriptDependencies());
       values.put("pluginDependencies", descriptor.pluginDependencies());
        values.put("source", detail.source());
        values.put("pythonRequirements", detail.pythonRequirements());
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

    private void resolveScriptDependencies(List<ScriptDependency> dependencies,
                                           boolean installScriptDependencies,
                                           boolean installPluginDependencies,
                                           boolean forcePluginUpgrade,
                                           LinkedHashSet<String> visiting) {
        for (ScriptDependency dependency : dependencies == null ? List.<ScriptDependency>of() : dependencies) {
            String scriptId = normalize(dependency.getScriptId(), "脚本依赖 scriptId 不能为空");
            String repositoryId = normalize(dependency.getRepositoryId(), "脚本依赖 repositoryId 不能为空: " + scriptId);
            String toolId = normalize(dependency.getToolId(), "脚本依赖 toolId 不能为空: " + scriptId);
            ScriptDefinition installed = scriptRepository.findInstalledByRepositorySource(repositoryId, toolId).orElse(null);
            if (installed != null && versionSatisfies(installed.getRepositoryVersion(), dependency.getVersionRange())) {
                continue;
            }
            if (!installScriptDependencies) {
                throw new IllegalArgumentException(
                        "缺少脚本依赖或版本不满足: " + scriptId + " -> " + repositoryId + "/" + toolId + " "
                                + normalizeOrDefault(dependency.getVersionRange(), "")
                );
            }

            RepositoryToolDescriptor descriptor = getRepositoryTool(repositoryId, toolId).descriptor();
            if (!versionSatisfies(descriptor.version(), dependency.getVersionRange())) {
                throw new IllegalArgumentException(
                        "仓库工具版本不满足脚本依赖: " + scriptId + " -> " + repositoryId + "/" + toolId + " "
                                + dependency.getVersionRange()
                );
            }
            installOrUpdateTool(
                    repositoryId,
                    toolId,
                    false,
                    installed != null,
                    true,
                    installPluginDependencies,
                    forcePluginUpgrade,
                    visiting
            );
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

    private void syncConfigTemplates(String repositoryId, String toolId, String repositoryVersion, List<ConfigTemplateItem> templates) {
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
                        .setSecret(template.secret())
                        .setRepositoryId(repositoryId)
                        .setRepositoryToolId(toolId)
                        .setRepositoryVersion(repositoryVersion)
                        .setPublishMode(publishMode)
                        .setManaged(true)
                        .setOverridden(false)
                        .setCreatedAt(LocalDateTime.now())
                        .setUpdatedAt(LocalDateTime.now()));
                continue;
            }
            boolean sameSource = Objects.equals(existing.getRepositoryId(), repositoryId)
                    && Objects.equals(existing.getRepositoryToolId(), toolId);
            if (sameSource) {
                existing.setDescription(normalizeNullable(template.label()))
                        .setSecret(template.secret())
                        .setRepositoryVersion(repositoryVersion)
                        .setPublishMode(publishMode)
                        .setManaged(true)
                        .setUpdatedAt(LocalDateTime.now());
                if (!existing.isOverridden()) {
                    existing.setValue(publishMode.equals(ConfigPublishMode.INLINE.name()) ? template.defaultValue() : "");
                }
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

    void writeToolFiles(Path toolDir,
                        String toolId,
                        ScriptDefinition script,
                        RepositoryPublishRequest request,
                        List<ConfigTemplateItem> configTemplates,
                        List<ScheduleTemplateItem> scheduleTemplates,
                        List<ScriptDependency> scriptDependencies) {
        try {
            Files.createDirectories(toolDir);
            String sourceFileName = script.getType() == ScriptType.PYTHON ? "source.py" : "source.groovy";
            Files.writeString(toolDir.resolve(sourceFileName), script.getPublishedSnapshot().getSource(), StandardCharsets.UTF_8);
            writeJson(toolDir.resolve("tool.json"), buildToolFile(script, request, sourceFileName, configTemplates, scheduleTemplates, scriptDependencies));
            writeJson(toolDir.resolve("input.schema.json"), script.getPublishedSnapshot().getInputSchema());
            writeJson(toolDir.resolve("output.schema.json"), script.getPublishedSnapshot().getOutputSchema());
            if (script.getPublishedSnapshot().getPythonRequirements() != null
                    && !script.getPublishedSnapshot().getPythonRequirements().isBlank()) {
                Files.writeString(toolDir.resolve("requirements.txt"), script.getPublishedSnapshot().getPythonRequirements(), StandardCharsets.UTF_8);
            }

            if (!configTemplates.isEmpty()) {
                writeJson(toolDir.resolve("config.template.json"), configTemplates);
            }
            if (!scheduleTemplates.isEmpty()) {
                writeJson(toolDir.resolve("schedules.template.json"), scheduleTemplates);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("写入仓库工具文件失败", exception);
        }
    }

    void writePluginFiles(Path pluginDir,
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
                                   String sourceFileName,
                                   List<ConfigTemplateItem> configTemplates,
                                   List<ScheduleTemplateItem> scheduleTemplates,
                                   List<ScriptDependency> scriptDependencies) {
        return new ToolFile(
                1,
                normalize(request.toolId(), "toolId 不能为空"),
                normalizeOrDefault(request.displayName(), script.getName()),
                normalize(request.version(), "version 不能为空"),
                script.getType().name(),
                script.getPackaging().name(),
                normalizeNullable(script.getDescription()),
                normalizeNullable(request.releaseNotes()),
                normalizeNullable(request.owner()),
                request.tags() == null ? List.of() : request.tags(),
                sourceFileName,
                script.getPublishedSnapshot().getPythonRequirements() == null || script.getPublishedSnapshot().getPythonRequirements().isBlank()
                        ? null
                        : "requirements.txt",
                "input.schema.json",
                "output.schema.json",
                configTemplates.isEmpty() ? null : "config.template.json",
                scheduleTemplates.isEmpty() ? null : "schedules.template.json",
                null,
                null,
                scriptDependencies,
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

    List<ScriptDependency> resolveToolScriptDependencies(String defaultRepositoryId,
                                                         ScriptDefinition script,
                                                         RepositoryPublishRequest request) {
        PublishedScriptSnapshot snapshot = script.getPublishedSnapshot();
        String source = snapshot == null ? script.getSource() : snapshot.getSource();
        int invocationCount = countScriptInvocations(source);
        int literalInvocationCount = countLiteralScriptInvocations(source);
        if (invocationCount != literalInvocationCount) {
            throw new IllegalArgumentException("仓库发布仅支持字面量 scripts.invoke(...) 依赖，请先移除动态脚本调用");
        }
        List<String> detectedScriptIds = extractScriptDependenciesFromSource(source);
        if (detectedScriptIds.isEmpty()) {
            return List.of();
        }

        Map<String, ScriptDependency> declaredByScriptId = new LinkedHashMap<>();
        for (ScriptDependency item : request.scriptDependencies() == null ? List.<ScriptDependency>of() : request.scriptDependencies()) {
            String scriptId = normalize(item.getScriptId(), "脚本依赖 scriptId 不能为空");
            if (declaredByScriptId.containsKey(scriptId)) {
                throw new IllegalArgumentException("脚本依赖重复声明: " + scriptId);
            }
            String repositoryId = normalizeOrDefault(item.getRepositoryId(), defaultRepositoryId);
            String toolId = normalize(item.getToolId(), "脚本依赖 toolId 不能为空: " + scriptId);
            RepositoryToolDescriptor descriptor = getRepositoryTool(repositoryId, toolId).descriptor();
            declaredByScriptId.put(scriptId, new ScriptDependency()
                    .setScriptId(scriptId)
                    .setRepositoryId(repositoryId)
                    .setToolId(toolId)
                    .setVersionRange(normalizeOrDefault(item.getVersionRange(), ">= " + descriptor.version())));
        }

        List<String> missing = detectedScriptIds.stream()
                .filter(scriptId -> !declaredByScriptId.containsKey(scriptId))
                .toList();
        if (!missing.isEmpty()) {
            throw new IllegalArgumentException("脚本依赖缺少仓库映射: " + String.join(", ", missing));
        }

        List<String> extras = declaredByScriptId.keySet().stream()
                .filter(scriptId -> !detectedScriptIds.contains(scriptId))
                .toList();
        if (!extras.isEmpty()) {
            throw new IllegalArgumentException("脚本依赖声明未在源码中使用: " + String.join(", ", extras));
        }

        List<ScriptDependency> dependencies = new ArrayList<>();
        for (String scriptId : detectedScriptIds) {
            dependencies.add(declaredByScriptId.get(scriptId));
        }
        return List.copyOf(dependencies);
    }

    static List<PluginDependency> extractPluginDependenciesFromSource(String source, Map<String, String> installedPluginVersions) {
        if (source == null || source.isBlank()) {
            return List.of();
        }

        Map<String, LinkedHashSet<String>> actionsByPlugin = new LinkedHashMap<>();
        Matcher matcher = PLUGIN_INVOKE_PATTERN.matcher(source);
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

    List<ConfigTemplateItem> buildConfigTemplate(RepositoryPublishConfigResolver.PublishConfigResolution resolution,
                                                 List<RepositoryPublishConfigItem> configItems) {
        return RepositoryPublishConfigResolver.buildTemplates(resolution, configItems);
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

    List<ScheduleTemplateItem> buildScheduleTemplate(List<ScriptSchedule> schedules) {
        List<ScheduleTemplateItem> templates = new ArrayList<>();
        for (ScriptSchedule schedule : schedules == null ? List.<ScriptSchedule>of() : schedules) {
            templates.add(new ScheduleTemplateItem(schedule.getId(), schedule.getScriptId(), schedule.getName(), schedule.getCronExpression(), schedule.getInput(), false));
        }
        return templates;
    }

    List<ScriptSchedule> resolvePublishSchedules(String scriptId, List<String> scheduleIds) {
        List<ScriptSchedule> schedules = new ArrayList<>();
        for (String scheduleId : scheduleIds == null ? List.<String>of() : scheduleIds) {
            String normalizedScheduleId = normalize(scheduleId, "定时任务 ID 不能为空");
            ScriptSchedule schedule = scriptScheduleRepository.findById(normalizedScheduleId)
                    .orElseThrow(() -> new IllegalArgumentException("定时任务不存在: " + normalizedScheduleId));
            if (!Objects.equals(scriptId, schedule.getScriptId())) {
                throw new IllegalArgumentException("定时任务不属于当前脚本: " + normalizedScheduleId);
            }
            schedules.add(schedule);
        }
        return schedules;
    }

    void updateRepositoryIndex(Path root,
                               RepositoryDefinition repository,
                               String toolId,
                               ScriptDefinition script,
                               RepositoryPublishRequest request) {
        RepositoryIndexFile current = Files.exists(root.resolve(REPOSITORY_INDEX_FILE))
                ? readJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryIndexFile.class)
                : new RepositoryIndexFile(1, repository.getName(), repository.getDescription(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>());
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
                new ArrayList<>(safePlugins(current)),
                new ArrayList<>(safeCapabilityPackages(current)),
                new ArrayList<>(safeSkills(current))
        ));
    }

    void updateRepositoryPluginIndex(Path root,
                                     RepositoryDefinition repository,
                                     String pluginId,
                                     String displayName,
                                     RepositoryPluginPublishRequest request,
                                     String version) {
        RepositoryIndexFile current = Files.exists(root.resolve(REPOSITORY_INDEX_FILE))
                ? readJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryIndexFile.class)
                : new RepositoryIndexFile(1, repository.getName(), repository.getDescription(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>());
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
                entries,
                new ArrayList<>(safeCapabilityPackages(current)),
                new ArrayList<>(safeSkills(current))
        ));
    }

    void commitAndPush(RepositoryDefinition repository, String toolId, String version, String releaseNotes) {
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
        runGit(root, List.of("git", "-C", root.toString(), "push", "origin", normalizeOrDefault(repository.getBranch(), "master")));
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
                    tool.pythonRequirementsPath() == null ? null : readRepositoryFile(repository, toolDirectoryPath(toolPath).resolve(tool.pythonRequirementsPath())),
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
                base.packaging(),
                base.sourcePath(),
                base.pythonRequirementsPath(),
                base.inputSchemaPath(),
                base.outputSchemaPath(),
                base.configTemplatePath(),
                base.scheduleTemplatePath(),
                base.digest(),
                base.riskLevel(),
                base.scriptDependencies(),
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
                resolvePackaging(tool.packaging()).name(),
                tool.sourcePath(),
                resolveRelative(toolPath, tool.pythonRequirementsPath()),
                resolveRelative(toolPath, tool.inputSchemaPath()),
                resolveRelative(toolPath, tool.outputSchemaPath()),
                resolveRelative(toolPath, tool.configTemplatePath()),
                resolveRelative(toolPath, tool.scheduleTemplatePath()),
                tool.digest(),
                tool.riskLevel(),
                tool.scriptDependencies() == null ? List.of() : tool.scriptDependencies(),
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

    private CapabilityPackageDescriptor toCapabilityPackageDescriptor(RepositoryDefinition repository,
                                                                      CapabilityPackageManifestFile manifest,
                                                                      String manifestPath) {
        String packageId = normalize(manifest.packageId(), "能力包 ID 不能为空");
        String installationId = capabilityPackageInstallationId(repository.getId(), packageId);
        CapabilityPackageInstallation installation = capabilityPackageInstallationRepository.findByInstallationId(installationId).orElse(null);
        return new CapabilityPackageDescriptor(
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
                "TRUSTED".equalsIgnoreCase(repository.getTrustLevel()),
                normalizeOrDefault(repository.getUsage(), "DISTRIBUTION")
        );
    }

    private AiPackageModelFile toAiPackageModelFile(AiModelProfile profile) {
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

    private AiPackageToolsetFile toAiPackageToolsetFile(AiToolset toolset) {
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

    private AiPackageAgentFile toAiPackageAgentFile(AiAgentProfile profile) {
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

    private AiPackageScriptFile toAiPackageScriptFile(ScriptDefinition published) {
        PublishedScriptSnapshot snapshot = published.getPublishedSnapshot();
        return new AiPackageScriptFile(
                published.getId(),
                snapshot == null ? published.getName() : snapshot.getName(),
                (snapshot == null ? published.getType() : snapshot.getType()).name(),
                (snapshot == null ? published.getPackaging() : snapshot.getPackaging()).name(),
                published.getDescription(),
                published.getTags(),
                snapshot == null ? published.getSource() : snapshot.getSource(),
                snapshot == null ? published.getPythonRequirements() : snapshot.getPythonRequirements(),
                snapshot == null ? published.getInputSchema() : snapshot.getInputSchema(),
                snapshot == null ? published.getOutputSchema() : snapshot.getOutputSchema(),
                published.getPluginDependencies(),
                snapshot == null ? published.getAiDependencies() : snapshot.getAiDependencies()
        );
    }

    private String rewriteToolName(String toolName,
                                   Map<String, String> agentIdMappings,
                                   Map<String, String> scriptIdMappings) {
        if (toolName == null || toolName.isBlank()) {
            return toolName;
        }
        if (toolName.startsWith("script.")) {
            String localId = toolName.substring("script.".length());
            return "script." + scriptIdMappings.getOrDefault(localId, localId);
        }
        if (toolName.startsWith("agent.")) {
            String localId = toolName.substring("agent.".length());
            return "agent." + agentIdMappings.getOrDefault(localId, localId);
        }
        return toolName;
    }

    private Map<String, Map<String, Object>> rewriteToolOptions(Map<String, Map<String, Object>> toolOptions,
                                                                Map<String, String> agentIdMappings,
                                                                Map<String, String> scriptIdMappings) {
        Map<String, Map<String, Object>> rewritten = new LinkedHashMap<>();
        for (Map.Entry<String, Map<String, Object>> entry : toolOptions == null ? Map.<String, Map<String, Object>>of().entrySet() : toolOptions.entrySet()) {
            rewritten.put(
                    rewriteToolName(entry.getKey(), agentIdMappings, scriptIdMappings),
                    entry.getValue() == null ? Map.of() : new LinkedHashMap<>(entry.getValue())
            );
        }
        return rewritten;
    }

    private String rewriteScriptSource(String source,
                                       Map<String, String> scriptIdMappings,
                                       Map<String, String> modelIdMappings,
                                       Map<String, String> agentIdMappings) {
        if (source == null || source.isBlank()) {
            return source;
        }
        String rewritten = replaceScriptInvokeIds(source, scriptIdMappings);
        rewritten = replaceProfileIds(rewritten, MODEL_PROFILE_LITERAL_PATTERN, modelIdMappings);
        return replaceProfileIds(rewritten, AGENT_PROFILE_LITERAL_PATTERN, agentIdMappings);
    }

    private String replaceScriptInvokeIds(String source, Map<String, String> scriptIdMappings) {
        Matcher matcher = SCRIPT_INVOKE_PATTERN.matcher(source);
        StringBuilder builder = new StringBuilder();
        while (matcher.find()) {
            String scriptId = matcher.group(2);
            String replacement = matcher.group(0).replace(scriptId, scriptIdMappings.getOrDefault(scriptId, scriptId));
            matcher.appendReplacement(builder, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(builder);
        return builder.toString();
    }

    private String replaceProfileIds(String source, Pattern pattern, Map<String, String> mappings) {
        Matcher matcher = pattern.matcher(source);
        StringBuilder builder = new StringBuilder();
        while (matcher.find()) {
            String replacement = matcher.group(1)
                    + matcher.group(2)
                    + mappings.getOrDefault(matcher.group(3), matcher.group(3))
                    + matcher.group(4);
            matcher.appendReplacement(builder, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(builder);
        return builder.toString();
    }

    private List<AiDependency> rewriteAiDependencies(List<AiDependency> dependencies,
                                                     Map<String, String> modelIdMappings,
                                                     Map<String, String> agentIdMappings) {
        List<AiDependency> rewritten = new ArrayList<>();
        for (AiDependency dependency : dependencies == null ? List.<AiDependency>of() : dependencies) {
            rewritten.add(new AiDependency()
                    .setCapability(dependency.getCapability())
                    .setProfile(modelIdMappings.getOrDefault(dependency.getProfile(), dependency.getProfile()))
                    .setAgentProfile(agentIdMappings.getOrDefault(dependency.getAgentProfile(), dependency.getAgentProfile()))
                    .setRequired(dependency.isRequired()));
        }
        return rewritten;
    }

    private String resolveCapabilityPackageRuntimeEntry(List<CapabilityPackageEntryFile> entries,
                                                        Map<String, String> agentIdMappings,
                                                        Map<String, String> scriptIdMappings) {
        for (CapabilityPackageEntryFile entry : entries == null ? List.<CapabilityPackageEntryFile>of() : entries) {
            if ("AGENT".equalsIgnoreCase(entry.type())) {
                return agentIdMappings.getOrDefault(entry.id(), entry.id());
            }
            if ("SCRIPT".equalsIgnoreCase(entry.type())) {
                return scriptIdMappings.getOrDefault(entry.id(), entry.id());
            }
        }
        return null;
    }

    private LinkedHashSet<AiCapability> readCapabilities(List<String> capabilities) {
        LinkedHashSet<AiCapability> values = new LinkedHashSet<>();
        for (String capability : capabilities == null ? List.<String>of() : capabilities) {
            if (capability == null || capability.isBlank()) {
                continue;
            }
            values.add(AiCapability.valueOf(capability.trim().toUpperCase(Locale.ROOT)));
        }
        return values;
    }

    private int countScriptInvocations(String source) {
        if (source == null || source.isBlank()) {
            return 0;
        }
        int count = 0;
        Matcher matcher = SCRIPT_INVOKE_ANY_PATTERN.matcher(source);
        while (matcher.find()) {
            count += 1;
        }
        return count;
    }

    private int countLiteralScriptInvocations(String source) {
        if (source == null || source.isBlank()) {
            return 0;
        }
        int count = 0;
        Matcher matcher = SCRIPT_INVOKE_PATTERN.matcher(source);
        while (matcher.find()) {
            count += 1;
        }
        return count;
    }

    private List<String> extractScriptDependenciesFromSource(String source) {
        if (source == null || source.isBlank()) {
            return List.of();
        }
        LinkedHashSet<String> dependencies = new LinkedHashSet<>();
        Matcher matcher = SCRIPT_INVOKE_PATTERN.matcher(source);
        while (matcher.find()) {
            String scriptId = normalizeNullable(matcher.group(2));
            if (scriptId != null) {
                dependencies.add(scriptId);
            }
        }
        return List.copyOf(dependencies);
    }

    private ScriptPackaging resolvePackaging(String packaging) {
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
        boolean usesAgent = dependencies.stream().anyMatch(this::isAgentDependency);
        if (usesAgent) {
            throw new IllegalArgumentException("TOOL 类型脚本不能依赖 Agent，请将脚本 packaging 改为 FLOW");
        }
    }

    private boolean isAgentDependency(AiDependency dependency) {
        if (dependency == null) {
            return false;
        }
        return (dependency.getAgentProfile() != null && !dependency.getAgentProfile().isBlank())
                || "AGENT_RUN".equalsIgnoreCase(dependency.getCapability());
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

    private RepositorySkillDescriptor toSkillDescriptor(RepositoryDefinition repository, SkillFile skill, String skillPath) {
        return new RepositorySkillDescriptor(
                repository.getId(),
                normalize(skill.skillId(), "skillId 不能为空"),
                normalizeOrDefault(skill.displayName(), skill.skillId()),
                normalize(skill.version(), "version 不能为空"),
                normalizeNullable(skill.description()),
                null,
                normalizeNullable(skill.owner()),
                skill.tags() == null ? List.of() : skill.tags(),
                skillPath,
                resolveRelative(skillPath, normalizeOrDefault(skill.entrypointPath(), "SKILL.md")),
                normalizeNullable(skill.digest()),
                normalizeNullable(skill.riskLevel()),
                "TRUSTED".equalsIgnoreCase(repository.getTrustLevel()),
                repository.getUsage()
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
                    "git", "clone", "--branch", normalizeOrDefault(repository.getBranch(), "master"),
                    "--single-branch", repository.getUrl(), root.toString()
            ));
            return;
        }
        runGit(root, List.of("git", "-C", root.toString(), "fetch", "origin", normalizeOrDefault(repository.getBranch(), "master")));
        runGit(root, List.of("git", "-C", root.toString(), "checkout", normalizeOrDefault(repository.getBranch(), "master")));
        runGit(root, List.of("git", "-C", root.toString(), "pull", "--ff-only", "origin", normalizeOrDefault(repository.getBranch(), "master")));
    }

    void ensureLocalDirRepository(RepositoryDefinition repository) {
        Path root = resolveRepositoryRoot(repository);
        ensureRepositoryWorkspace(root, repository, jsonCodec);
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
        if ("GIT".equals(repository.getType())) {
            ensureRepositoryWorkspace(root, repository, jsonCodec);
        }
        return readJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryIndexFile.class);
    }

    private ToolFile readToolFile(RepositoryDefinition repository, String toolPath) {
        if ("HTTP".equals(repository.getType())) {
            return readHttpJson(joinHttpPath(repository.getUrl(), toolPath), ToolFile.class);
        }
        return readJson(safeResolveRepositoryPath(resolveRepositoryRoot(repository), toolPath), ToolFile.class);
    }

    private PluginFile readPluginFile(RepositoryDefinition repository, String pluginPath) {
        if ("HTTP".equals(repository.getType())) {
            return readHttpJson(joinHttpPath(repository.getUrl(), pluginPath), PluginFile.class);
        }
        return readJson(safeResolveRepositoryPath(resolveRepositoryRoot(repository), pluginPath), PluginFile.class);
    }

    private SkillFile readSkillFile(RepositoryDefinition repository, String skillPath) {
        if ("HTTP".equals(repository.getType())) {
            return readHttpJson(joinHttpPath(repository.getUrl(), skillPath), SkillFile.class);
        }
        return readJson(safeResolveRepositoryPath(resolveRepositoryRoot(repository), skillPath), SkillFile.class);
    }

    private CapabilityPackageManifestFile readCapabilityPackageManifest(RepositoryDefinition repository, String manifestPath) {
        if ("HTTP".equals(repository.getType())) {
            return readHttpJson(joinHttpPath(repository.getUrl(), manifestPath), CapabilityPackageManifestFile.class);
        }
        return readJson(safeResolveRepositoryPath(resolveRepositoryRoot(repository), manifestPath), CapabilityPackageManifestFile.class);
    }

    private CapabilityPackageReleaseFile readCapabilityPackageRelease(RepositoryDefinition repository, String releasePath) {
        if ("HTTP".equals(repository.getType())) {
            return readHttpJson(joinHttpPath(repository.getUrl(), releasePath), CapabilityPackageReleaseFile.class);
        }
        return readJson(safeResolveRepositoryPath(resolveRepositoryRoot(repository), releasePath), CapabilityPackageReleaseFile.class);
    }

    private String readRepositoryFile(RepositoryDefinition repository, Path path) {
        if ("HTTP".equals(repository.getType())) {
            return readHttpText(joinHttpPath(repository.getUrl(), path.toString().replace('\\', '/')));
        }
        try {
            return Files.readString(safeResolveRepositoryPath(resolveRepositoryRoot(repository), path.toString()), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new IllegalStateException("读取仓库文件失败: " + path, exception);
        }
    }

    private void copyDirectory(Path source, Path target) throws IOException {
        Files.walkFileTree(source, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
                Path relative = source.relativize(dir);
                Path targetDir = target.resolve(relative.toString()).normalize();
                Files.createDirectories(targetDir);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                if (Files.isSymbolicLink(file)) {
                    throw new IllegalArgumentException("Skill 不允许包含符号链接: " + file);
                }
                Path relative = source.relativize(file);
                Path targetFile = target.resolve(relative.toString()).normalize();
                Files.copy(file, targetFile, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.COPY_ATTRIBUTES);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private void moveAtomically(Path source, Path target) throws IOException {
        try {
            Files.move(source, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (java.nio.file.AtomicMoveNotSupportedException ignored) {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private void deleteQuietly(Path path) {
        if (path == null || Files.notExists(path)) {
            return;
        }
        try {
            Files.walkFileTree(path, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                    Files.deleteIfExists(file);
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult postVisitDirectory(Path dir, IOException exc) throws IOException {
                    Files.deleteIfExists(dir);
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException ignored) {
        }
    }

    private byte[] readRepositoryBytes(RepositoryDefinition repository, Path path) {
        if ("HTTP".equals(repository.getType())) {
            return readHttpBytes(joinHttpPath(repository.getUrl(), path.toString().replace('\\', '/')));
        }
        try {
            return Files.readAllBytes(safeResolveRepositoryPath(resolveRepositoryRoot(repository), path.toString()));
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
    private Path safeResolveRepositoryPath(Path root, String relativePath) {
        if (relativePath == null || relativePath.isBlank()) {
            throw new IllegalArgumentException("仓库文件路径不能为空");
        }
        if (relativePath.contains("..")) {
            throw new IllegalArgumentException("仓库文件路径不允许包含 ..: " + relativePath);
        }
        Path parsed = Path.of(relativePath);
        if (parsed.isAbsolute()) {
            throw new IllegalArgumentException("仓库文件路径不允许使用绝对路径: " + relativePath);
        }
        Path normalizedRoot = root.toAbsolutePath().normalize();
        Path target = normalizedRoot.resolve(parsed).normalize();
        if (!target.startsWith(normalizedRoot)) {
            throw new IllegalArgumentException("仓库文件越界访问被拒绝: " + relativePath);
        }
        return target;
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
        if (type != RepositoryIndexFile.class
                && type != ToolFile.class
                && type != PluginFile.class
                && type != SkillFile.class
                && type != CapabilityPackageManifestFile.class
                && type != CapabilityPackageReleaseFile.class) {
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

    static RepositoryIndexFile emptyRepositoryIndex(RepositoryDefinition repository) {
        String repositoryName = trimToNull(repository == null ? null : repository.getName());
        String repositoryId = trimToNull(repository == null ? null : repository.getId());
        return new RepositoryIndexFile(
                1,
                repositoryName != null ? repositoryName : repositoryId,
                trimToNull(repository == null ? null : repository.getDescription()),
                new ArrayList<>(),
                new ArrayList<>(),
                new ArrayList<>(),
                new ArrayList<>()
        );
    }

    private static String trimToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
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
        validateHttpRelativePath(relativePath);
        String normalizedRelative = relativePath.startsWith("/") ? relativePath.substring(1) : relativePath;
        return normalizedBase + "/" + normalizedRelative;
    }

    private void validateHttpRelativePath(String relativePath) {
        if (relativePath == null || relativePath.isBlank()) {
            throw new IllegalArgumentException("仓库文件路径不能为空");
        }
        if (relativePath.contains("..")) {
            throw new IllegalArgumentException("仓库文件路径不允许包含 ..: " + relativePath);
        }
        Path parsed = Path.of(relativePath);
        if (parsed.isAbsolute()) {
            throw new IllegalArgumentException("仓库文件路径不允许使用绝对路径: " + relativePath);
        }
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

    private List<CapabilityPackageIndexEntry> safeCapabilityPackages(RepositoryIndexFile index) {
        return index == null || index.packages() == null ? List.of() : index.packages();
    }

    private List<RepositorySkillIndexEntry> safeSkills(RepositoryIndexFile index) {
        return index == null || index.skills() == null ? List.of() : index.skills();
    }

    private List<AiPackageModelFile> safeModels(CapabilityPackageReleaseFile file) {
        return file == null || file.models() == null ? List.of() : file.models();
    }

    private List<AiPackageToolsetFile> safeToolsets(CapabilityPackageReleaseFile file) {
        return file == null || file.toolsets() == null ? List.of() : file.toolsets();
    }

    private List<AiPackageAgentFile> safeAgents(CapabilityPackageReleaseFile file) {
        return file == null || file.agents() == null ? List.of() : file.agents();
    }

    private List<AiPackageScriptFile> safeScripts(CapabilityPackageReleaseFile file) {
        return file == null || file.scripts() == null ? List.of() : file.scripts();
    }

    RepositoryIndexFile readRepositoryIndexFile(Path root, RepositoryDefinition repository) {
        return Files.exists(root.resolve(REPOSITORY_INDEX_FILE))
                ? readJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryIndexFile.class)
                : new RepositoryIndexFile(1, repository.getName(), repository.getDescription(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>());
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

    static void assertCapabilityPackageVersionAvailable(String repositoryId,
                                                        RepositoryIndexFile index,
                                                        String packageId,
                                                        String version) {
        for (CapabilityPackageIndexEntry entry : index == null || index.packages() == null ? List.<CapabilityPackageIndexEntry>of() : index.packages()) {
            if (Objects.equals(packageId, entry.id()) && Objects.equals(version, entry.version())) {
                throw new RepositoryVersionExistsException("CAPABILITY_PACKAGE", repositoryId, packageId, version);
            }
        }
    }

    static void assertSkillVersionAvailable(String repositoryId,
                                            RepositoryIndexFile index,
                                            String skillId,
                                            String version) {
        for (RepositorySkillIndexEntry entry : index == null || index.skills() == null ? List.<RepositorySkillIndexEntry>of() : index.skills()) {
            if (Objects.equals(skillId, entry.id()) && Objects.equals(version, entry.version())) {
                throw new RepositoryVersionExistsException("SKILL", repositoryId, skillId, version);
            }
        }
    }

    private RelativeRepositoryPath toolDirectoryPath(String toolPath) {
        return new RelativeRepositoryPath(Path.of(toolPath).getParent().toString().replace('\\', '/'));
    }

    private RelativeRepositoryPath skillDirectoryPath(String skillPath) {
        return new RelativeRepositoryPath(Path.of(skillPath).getParent().toString().replace('\\', '/'));
    }

    private RelativeRepositoryPath capabilityPackageDirectoryPath(String packagePath) {
        return new RelativeRepositoryPath(Path.of(packagePath).getParent().toString().replace('\\', '/'));
    }

    String normalize(String value, String message) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(message);
        }
        return value.trim();
    }

    String normalizeOrDefault(String value, String defaultValue) {
        return value == null || value.isBlank() ? defaultValue : value.trim();
    }

    String normalizeNullable(String value) {
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

    public record CapabilityPackagePublishPreviewRequest(
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
            CapabilityPackageInstallation installation,
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

    private record CapabilityPackageDraft(String packageId,
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
    }

    public record AiPackageToolsetFile(String id,
                                       String name,
                                       String description,
                                       List<String> toolNames,
                                       Map<String, Map<String, Object>> toolOptions,
                                       String maxPermission,
                                       boolean enabled) {
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
    }

    public record ConfigTemplateItem(String key,
                                     String label,
                                     String type,
                                     boolean required,
                                     boolean secret,
                                     String defaultValue) {
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

    private final class AiPackageBundleBuilder {
        private final String repositoryId;
        private final String packageId;
        private final String entryAgentId;
        private String entryAgentName;
        private String entryAgentDescription;
        private final Map<String, AiPackageModelFile> models = new LinkedHashMap<>();
        private final Map<String, AiPackageToolsetFile> toolsets = new LinkedHashMap<>();
        private final Map<String, AiPackageAgentFile> agents = new LinkedHashMap<>();
        private final Map<String, AiPackageScriptFile> scripts = new LinkedHashMap<>();
        private final Map<String, RepositoryAiPackageDependency> externalDependencies = new LinkedHashMap<>();
        private final LinkedHashSet<String> externalAgentIds = new LinkedHashSet<>();
        private final LinkedHashSet<String> externalScriptIds = new LinkedHashSet<>();

        private AiPackageBundleBuilder(RepositoryDefinition repository, String packageId, String entryAgentId) {
            this.repositoryId = repository.getId();
            this.packageId = packageId;
            this.entryAgentId = entryAgentId;
        }

        private String entryAgentId() {
            return entryAgentId;
        }

        private boolean hasModel(String id) {
            return models.containsKey(id);
        }

        private boolean hasToolset(String id) {
            return toolsets.containsKey(id);
        }

        private boolean hasAgent(String id) {
            return agents.containsKey(id);
        }

        private boolean hasScript(String id) {
            return scripts.containsKey(id);
        }

        private boolean isExternalAgent(String id) {
            return externalAgentIds.contains(id);
        }

        private boolean isExternalScript(String id) {
            return externalScriptIds.contains(id);
        }

        private void addModel(String id, AiPackageModelFile file) {
            models.putIfAbsent(id, new AiPackageModelFile(
                    id,
                    file.name(),
                    file.provider(),
                    file.modelProvider(),
                    file.modelName(),
                    file.baseUrl(),
                    file.apiKeyConfigKey(),
                    file.defaultOptions(),
                    file.limits(),
                    file.capabilities(),
                    file.enabled()
            ));
        }

        private void addToolset(String id, AiPackageToolsetFile file) {
            toolsets.putIfAbsent(id, new AiPackageToolsetFile(
                    id,
                    file.name(),
                    file.description(),
                    file.toolNames(),
                    file.toolOptions(),
                    file.maxPermission(),
                    file.enabled()
            ));
        }

        private void addAgent(String id, AiPackageAgentFile file) {
            agents.putIfAbsent(id, new AiPackageAgentFile(
                    id,
                    file.name(),
                    file.description(),
                    file.provider(),
                    file.modelProfileId(),
                    file.systemPrompt(),
                    file.toolsetIds(),
                    file.directToolNames(),
                    file.directToolOptions(),
                    file.skillIds(),
                    file.options(),
                    file.enabled()
            ));
            if (Objects.equals(id, entryAgentId)) {
                entryAgentName = file.name();
                entryAgentDescription = file.description();
            }
        }

        private void addScript(String id, AiPackageScriptFile file) {
            scripts.putIfAbsent(id, new AiPackageScriptFile(
                    id,
                    file.name(),
                    file.type(),
                    file.packaging(),
                    file.description(),
                    file.tags(),
                    file.source(),
                    file.pythonRequirements(),
                    file.inputSchema(),
                    file.outputSchema(),
                    file.pluginDependencies(),
                    file.aiDependencies()
            ));
        }

        private void addExternalDependency(RepositoryAiPackageDependency dependency) {
            externalDependencies.putIfAbsent(
                    dependency.assetType() + ":" + dependency.repositoryId() + ":" + dependency.assetId(),
                    dependency
            );
            if ("AI_PACKAGE".equalsIgnoreCase(dependency.assetType())) {
                externalAgentIds.add(aiPackageEntryAgentRuntimeId(dependency.repositoryId(), dependency.assetId()));
            }
            if ("TOOL".equalsIgnoreCase(dependency.assetType())) {
                externalScriptIds.add(dependency.repositoryId() + "." + dependency.assetId());
            }
        }

        private AiPackageBundle build() {
            return new AiPackageBundle(
                    repositoryId,
                    packageId,
                    entryAgentId,
                    entryAgentName,
                    entryAgentDescription,
                    Map.copyOf(models),
                    Map.copyOf(toolsets),
                    Map.copyOf(agents),
                    Map.copyOf(scripts),
                    Map.copyOf(externalDependencies)
            );
        }
    }

    private record RelativeRepositoryPath(String value) {
        private Path resolve(String child) {
            validateNoTraversal(child);
            Path resolved = Path.of(value).resolve(child).normalize();
            if (!resolved.startsWith(Path.of(value).normalize())) {
                throw new IllegalArgumentException("仓库文件越界访问被拒绝: " + child);
            }
            return resolved;
        }

        private RelativeRepositoryPath resolveNullable(String child) {
            if (child == null || child.isBlank()) {
                return null;
            }
            validateNoTraversal(child);
            Path resolved = Path.of(value).resolve(child).normalize();
            if (!resolved.startsWith(Path.of(value).normalize())) {
                throw new IllegalArgumentException("仓库文件越界访问被拒绝: " + child);
            }
            return new RelativeRepositoryPath(resolved.toString().replace('\\', '/'));
        }

        private void validateNoTraversal(String path) {
            if (path != null && path.contains("..")) {
                throw new IllegalArgumentException("仓库文件路径不允许包含 ..: " + path);
            }
        }
    }

    private record ToolSourceState(String path, String commit, String digest) {
    }
}
