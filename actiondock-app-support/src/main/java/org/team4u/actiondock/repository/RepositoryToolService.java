package org.team4u.actiondock.repository;

import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.exception.RepositoryVersionExistsException;
import org.team4u.actiondock.domain.model.ConfigPublishMode;
import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.model.PluginDependency;
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
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.RepositoryToolInstallationRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.plugin.PluginView;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 仓库工具安装、更新、卸载、开发和发布服务。
 * <p>
 * 从 {@link RepositoryCatalogService} 中提取，负责工具从仓库的安装、升级、卸载，
 * 开发同步、发布配置预览、依赖解析等职责。
 *
 * @author jay.wu
 */
public class RepositoryToolService {

    private static final Pattern PLUGIN_INVOKE_PATTERN = Pattern.compile(
            "plugins\\s*\\.\\s*invoke\\s*\\(\\s*([\"'`])([^\"'`]+)\\1\\s*,\\s*([\"'`])([^\"'`]+)\\3"
    );
    private static final Pattern SCRIPT_INVOKE_PATTERN = Pattern.compile(
            "scripts\\s*\\.\\s*invoke\\s*\\(\\s*([\"'`])([^\"'`]+)\\1"
    );
    private static final Pattern SCRIPT_INVOKE_ANY_PATTERN = Pattern.compile(
            "scripts\\s*\\.\\s*invoke\\s*\\("
    );

    private final RepositoryCatalogService catalog;
    private final RepositoryPluginService pluginService;
    private final ScriptApplicationService scriptApplicationService;
    private final ScriptRepository scriptRepository;
    private final ScriptScheduleRepository scriptScheduleRepository;
    private final RepositoryToolInstallationRepository repositoryToolInstallationRepository;
    private final ConfigValueRepository configValueRepository;
    private final PluginRuntimeService pluginRuntimeService;
    private final ToolRepositoryPublisher toolRepositoryPublisher;

    public RepositoryToolService(RepositoryCatalogService catalog,
                                 RepositoryPluginService pluginService,
                                 ScriptApplicationService scriptApplicationService,
                                 ScriptRepository scriptRepository,
                                 ScriptScheduleRepository scriptScheduleRepository,
                                 RepositoryToolInstallationRepository repositoryToolInstallationRepository,
                                 ConfigValueRepository configValueRepository,
                                 PluginRuntimeService pluginRuntimeService) {
        this.catalog = catalog;
        this.pluginService = pluginService;
        this.scriptApplicationService = scriptApplicationService;
        this.scriptRepository = scriptRepository;
        this.scriptScheduleRepository = scriptScheduleRepository;
        this.repositoryToolInstallationRepository = repositoryToolInstallationRepository;
        this.configValueRepository = configValueRepository;
        this.pluginRuntimeService = pluginRuntimeService;
        this.toolRepositoryPublisher = new ToolRepositoryPublisher(catalog, this);
        catalog.setToolService(this);
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

    public ScriptDefinition syncToolForDevelopment(String repositoryId, String toolId, RepositoryCatalogService.DevelopmentSyncRequest request) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        catalog.ensureDevelopmentRepository(repository);
        RepositoryCatalogService.RepositoryToolDetail detail = catalog.getRepositoryTool(repositoryId, toolId);
        String scriptId = catalog.normalizeOrDefault(request == null ? null : request.scriptId(), detail.descriptor().toolId());
        ScriptDefinition existing = scriptRepository.findById(scriptId).orElse(null);
        if (existing != null && existing.getScope() != ScriptScope.DEVELOPMENT) {
            throw new IllegalArgumentException("脚本 ID 已存在，请指定其他开发脚本 ID: " + scriptId);
        }
        if (existing != null) {
            return pullDevelopmentScript(scriptId, false);
        }
        RepositoryCatalogService.ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        return saveDevelopmentScript(scriptId, existing, detail, state);
    }

    public RepositoryCatalogService.DevelopmentStatus getDevelopmentStatus(String scriptId) {
        ScriptDefinition script = scriptApplicationService.get(scriptId);
        catalog.ensureDevelopmentScript(script);
        RepositoryDefinition repository = catalog.getRepository(script.getRepositoryId());
        RepositoryCatalogService.RepositoryToolDetail detail = catalog.getRepositoryTool(repository.getId(), script.getRepositoryToolId());
        RepositoryCatalogService.ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        String localDigest = catalog.computeDevelopmentLocalDigest(script);
        String syncState = catalog.resolveDevelopmentSyncState(script, localDigest, state);
        boolean remoteChanged = catalog.isRemoteChanged(script, state);
        boolean dirty = catalog.isLocalChanged(script, localDigest);
        return new RepositoryCatalogService.DevelopmentStatus(
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
        catalog.ensureDevelopmentScript(script);
        RepositoryDefinition repository = catalog.getRepository(script.getRepositoryId());
        catalog.syncRepository(repository.getId());
        RepositoryCatalogService.RepositoryToolDetail detail = catalog.getRepositoryTool(repository.getId(), script.getRepositoryToolId());
        RepositoryCatalogService.ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        String localDigest = catalog.computeDevelopmentLocalDigest(script);
        String syncState = catalog.resolveDevelopmentSyncState(script, localDigest, state);
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

    public RepositoryCatalogService.RepositoryPublishConfigPreview previewPublishConfig(RepositoryCatalogService.RepositoryPublishConfigPreviewRequest request) {
        String scriptId = catalog.normalize(request == null ? null : request.scriptId(), "scriptId 不能为空");
        List<ScriptSchedule> schedules = resolvePublishSchedules(scriptId, request == null ? null : request.scheduleIds());
        RepositoryPublishConfigResolver.PublishConfigResolution resolution = RepositoryPublishConfigResolver.resolve(
                request == null ? null : request.source(),
                schedules.stream().map(ScriptSchedule::getInput).toList(),
                configValueRepository.findAll()
        );
        return new RepositoryCatalogService.RepositoryPublishConfigPreview(
                resolution.items().stream()
                        .map(item -> new RepositoryCatalogService.RepositoryPublishConfigCandidate(item.key(), item.label(), item.secret()))
                        .toList(),
                resolution.missingKeys()
        );
    }

    public RepositoryCatalogService.RepositoryToolDescriptor publishTool(String repositoryId, RepositoryCatalogService.RepositoryPublishRequest request) {
        return toolRepositoryPublisher.publish(repositoryId, request);
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
            RepositoryCatalogService.RepositoryToolDetail detail = catalog.getRepositoryTool(repositoryId, toolId);
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
            pluginService.resolvePluginDependencies(repositoryId, detail.descriptor().pluginDependencies(), installPluginDependencies, forcePluginUpgrade);

            LocalDateTime now = LocalDateTime.now();
            ScriptPackaging packaging = catalog.resolvePackaging(detail.descriptor().packaging());
            Map<String, Object> inputSchema = catalog.readSchema(repositoryId, detail.descriptor().inputSchemaPath());
            Map<String, Object> outputSchema = catalog.readSchema(repositoryId, detail.descriptor().outputSchemaPath());
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

    private void resolveScriptDependencies(List<ScriptDependency> dependencies,
                                           boolean installScriptDependencies,
                                           boolean installPluginDependencies,
                                           boolean forcePluginUpgrade,
                                           LinkedHashSet<String> visiting) {
        for (ScriptDependency dependency : dependencies == null ? List.<ScriptDependency>of() : dependencies) {
            String scriptId = catalog.normalize(dependency.getScriptId(), "脚本依赖 scriptId 不能为空");
            String depRepositoryId = catalog.normalize(dependency.getRepositoryId(), "脚本依赖 repositoryId 不能为空: " + scriptId);
            String depToolId = catalog.normalize(dependency.getToolId(), "脚本依赖 toolId 不能为空: " + scriptId);
            ScriptDefinition installed = scriptRepository.findInstalledByRepositorySource(depRepositoryId, depToolId).orElse(null);
            if (installed != null && RepositoryCatalogService.versionSatisfies(installed.getRepositoryVersion(), dependency.getVersionRange())) {
                continue;
            }
            if (!installScriptDependencies) {
                throw new IllegalArgumentException(
                        "缺少脚本依赖或版本不满足: " + scriptId + " -> " + depRepositoryId + "/" + depToolId + " "
                                + catalog.normalizeOrDefault(dependency.getVersionRange(), "")
                );
            }

            RepositoryCatalogService.RepositoryToolDescriptor descriptor = catalog.getRepositoryTool(depRepositoryId, depToolId).descriptor();
            if (!RepositoryCatalogService.versionSatisfies(descriptor.version(), dependency.getVersionRange())) {
                throw new IllegalArgumentException(
                        "仓库工具版本不满足脚本依赖: " + scriptId + " -> " + depRepositoryId + "/" + depToolId + " "
                                + dependency.getVersionRange()
                );
            }
            installOrUpdateTool(
                    depRepositoryId,
                    depToolId,
                    false,
                    installed != null,
                    true,
                    installPluginDependencies,
                    forcePluginUpgrade,
                    visiting
            );
        }
    }

    private void syncConfigTemplates(String repositoryId, String toolId, String repositoryVersion, List<RepositoryCatalogService.ConfigTemplateItem> templates) {
        for (RepositoryCatalogService.ConfigTemplateItem template : templates) {
            ConfigValue existing = configValueRepository.findByKey(template.key()).orElse(null);
            String publishMode = (template.secret() || template.defaultValue() == null || template.defaultValue().isBlank())
                    ? ConfigPublishMode.PLACEHOLDER.name()
                    : ConfigPublishMode.INLINE.name();
            if (existing == null) {
                configValueRepository.save(new ConfigValue()
                        .setKey(template.key())
                        .setValue(publishMode.equals(ConfigPublishMode.INLINE.name()) ? template.defaultValue() : "")
                        .setDescription(catalog.normalizeNullable(template.label()))
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
                existing.setDescription(catalog.normalizeNullable(template.label()))
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

    private void syncScheduleTemplates(ScriptDefinition definition, List<RepositoryCatalogService.ScheduleTemplateItem> templates) {
        List<ScriptSchedule> all = scriptScheduleRepository.findAll();
        for (RepositoryCatalogService.ScheduleTemplateItem template : templates) {
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

    private ScriptDefinition saveDevelopmentScript(String scriptId,
                                                   ScriptDefinition existing,
                                                   RepositoryCatalogService.RepositoryToolDetail detail,
                                                   RepositoryCatalogService.ToolSourceState state) {
        LocalDateTime now = LocalDateTime.now();
        ScriptPackaging packaging = catalog.resolvePackaging(detail.descriptor().packaging());
        Map<String, Object> inputSchema = catalog.readSchema(detail.descriptor().repositoryId(), detail.descriptor().inputSchemaPath());
        Map<String, Object> outputSchema = catalog.readSchema(detail.descriptor().repositoryId(), detail.descriptor().outputSchemaPath());
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
        RepositoryCatalogService.RepositoryToolDetail detail = catalog.getRepositoryTool(repository.getId(), script.getRepositoryToolId());
        RepositoryCatalogService.ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        String syncState = catalog.resolveDevelopmentSyncState(script, catalog.computeDevelopmentLocalDigest(script), state);
        if ("REMOTE_CHANGES".equals(syncState) || "DIVERGED".equals(syncState)) {
            throw new DevelopmentConflictException(script.getId(), script.getRepositoryId(), script.getRepositoryToolId());
        }
    }

    void updateDevelopmentSourceMetadata(ScriptDefinition sourceScript,
                                         RepositoryDefinition repository,
                                         RepositoryCatalogService.RepositoryToolDetail detail) {
        RepositoryCatalogService.ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        ScriptDefinition updated = scriptApplicationService.get(sourceScript.getId())
                .setRepositoryVersion(detail.descriptor().version())
                .setSourcePath(state.path())
                .setSourceCommit(state.commit())
                .setSourceDigest(state.digest())
                .setSourceSyncedAt(LocalDateTime.now())
                .setDirty(false);
        scriptRepository.save(updated);
    }

    void writeToolFiles(Path toolDir,
                        String toolId,
                        ScriptDefinition script,
                        RepositoryCatalogService.RepositoryPublishRequest request,
                        List<RepositoryCatalogService.ConfigTemplateItem> configTemplates,
                        List<RepositoryCatalogService.ScheduleTemplateItem> scheduleTemplates,
                        List<ScriptDependency> scriptDependencies) {
        try {
            Files.createDirectories(toolDir);
            String sourceFileName = script.getType() == ScriptType.PYTHON ? "source.py" : "source.groovy";
            Files.writeString(toolDir.resolve(sourceFileName), script.getPublishedSnapshot().getSource(), StandardCharsets.UTF_8);
            catalog.writeJson(toolDir.resolve("tool.json"), buildToolFile(script, request, sourceFileName, configTemplates, scheduleTemplates, scriptDependencies));
            catalog.writeJson(toolDir.resolve("input.schema.json"), script.getPublishedSnapshot().getInputSchema());
            catalog.writeJson(toolDir.resolve("output.schema.json"), script.getPublishedSnapshot().getOutputSchema());
            if (script.getPublishedSnapshot().getPythonRequirements() != null
                    && !script.getPublishedSnapshot().getPythonRequirements().isBlank()) {
                Files.writeString(toolDir.resolve("requirements.txt"), script.getPublishedSnapshot().getPythonRequirements(), StandardCharsets.UTF_8);
            }

            if (!configTemplates.isEmpty()) {
                catalog.writeJson(toolDir.resolve("config.template.json"), configTemplates);
            }
            if (!scheduleTemplates.isEmpty()) {
                catalog.writeJson(toolDir.resolve("schedules.template.json"), scheduleTemplates);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("写入仓库工具文件失败", exception);
        }
    }

    private RepositoryCatalogService.ToolFile buildToolFile(ScriptDefinition script,
                                   RepositoryCatalogService.RepositoryPublishRequest request,
                                   String sourceFileName,
                                   List<RepositoryCatalogService.ConfigTemplateItem> configTemplates,
                                   List<RepositoryCatalogService.ScheduleTemplateItem> scheduleTemplates,
                                   List<ScriptDependency> scriptDependencies) {
        return new RepositoryCatalogService.ToolFile(
                1,
                catalog.normalize(request.toolId(), "toolId 不能为空"),
                catalog.normalizeOrDefault(request.displayName(), script.getName()),
                catalog.normalize(request.version(), "version 不能为空"),
                script.getType().name(),
                script.getPackaging().name(),
                catalog.normalizeNullable(script.getDescription()),
                catalog.normalizeNullable(request.releaseNotes()),
                catalog.normalizeNullable(request.owner()),
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
                                                         RepositoryCatalogService.RepositoryPublishRequest request) {
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
            String scriptId = catalog.normalize(item.getScriptId(), "脚本依赖 scriptId 不能为空");
            if (declaredByScriptId.containsKey(scriptId)) {
                throw new IllegalArgumentException("脚本依赖重复声明: " + scriptId);
            }
            String repositoryId = catalog.normalizeOrDefault(item.getRepositoryId(), defaultRepositoryId);
            String toolId = catalog.normalize(item.getToolId(), "脚本依赖 toolId 不能为空: " + scriptId);
            RepositoryCatalogService.RepositoryToolDescriptor descriptor = catalog.getRepositoryTool(repositoryId, toolId).descriptor();
            declaredByScriptId.put(scriptId, new ScriptDependency()
                    .setScriptId(scriptId)
                    .setRepositoryId(repositoryId)
                    .setToolId(toolId)
                    .setVersionRange(catalog.normalizeOrDefault(item.getVersionRange(), ">= " + descriptor.version())));
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

    List<RepositoryCatalogService.ConfigTemplateItem> buildConfigTemplate(RepositoryPublishConfigResolver.PublishConfigResolution resolution,
                                                 List<RepositoryCatalogService.RepositoryPublishConfigItem> configItems) {
        return RepositoryPublishConfigResolver.buildTemplates(resolution, configItems);
    }

    List<RepositoryCatalogService.ScheduleTemplateItem> buildScheduleTemplate(List<ScriptSchedule> schedules) {
        List<RepositoryCatalogService.ScheduleTemplateItem> templates = new ArrayList<>();
        for (ScriptSchedule schedule : schedules == null ? List.<ScriptSchedule>of() : schedules) {
            templates.add(new RepositoryCatalogService.ScheduleTemplateItem(schedule.getId(), schedule.getScriptId(), schedule.getName(), schedule.getCronExpression(), schedule.getInput(), false));
        }
        return templates;
    }

    List<ScriptSchedule> resolvePublishSchedules(String scriptId, List<String> scheduleIds) {
        List<ScriptSchedule> schedules = new ArrayList<>();
        for (String scheduleId : scheduleIds == null ? List.<String>of() : scheduleIds) {
            String normalizedScheduleId = catalog.normalize(scheduleId, "定时任务 ID 不能为空");
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
                               RepositoryCatalogService.RepositoryPublishRequest request) {
        RepositoryCatalogService.RepositoryIndexFile current = Files.exists(root.resolve("actiondock.repository.json"))
                ? catalog.readJson(root.resolve("actiondock.repository.json"), RepositoryCatalogService.RepositoryIndexFile.class)
                : new RepositoryCatalogService.RepositoryIndexFile(1, repository.getName(), repository.getDescription(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>());
        List<RepositoryCatalogService.RepositoryIndexEntry> entries = new ArrayList<>(current.tools() == null ? List.of() : current.tools());
        RepositoryCatalogService.RepositoryIndexEntry next = new RepositoryCatalogService.RepositoryIndexEntry(
                toolId,
                catalog.normalizeOrDefault(request.displayName(), script.getName()),
                catalog.normalize(request.version(), "version 不能为空"),
                script.getType().name(),
                catalog.normalizeNullable(script.getDescription()),
                catalog.normalizeNullable(request.releaseNotes()),
                "tools/" + toolId + "/tool.json"
        );
        entries.removeIf(item -> toolId.equals(item.id()));
        entries.add(next);
        entries.sort(Comparator.comparing(RepositoryCatalogService.RepositoryIndexEntry::id));
        catalog.writeJson(root.resolve("actiondock.repository.json"), new RepositoryCatalogService.RepositoryIndexFile(
                1,
                repository.getName(),
                catalog.normalizeNullable(repository.getDescription()),
                entries,
                new ArrayList<>(catalog.safePlugins(current)),
                new ArrayList<>(catalog.safeCapabilityPackages(current)),
                new ArrayList<>(catalog.safeSkills(current))
        ));
    }

    static void assertToolVersionAvailable(String repositoryId,
                                           RepositoryCatalogService.RepositoryIndexFile index,
                                           String toolId,
                                           String version) {
        for (RepositoryCatalogService.RepositoryIndexEntry entry : index == null || index.tools() == null ? List.<RepositoryCatalogService.RepositoryIndexEntry>of() : index.tools()) {
            if (Objects.equals(toolId, entry.id()) && Objects.equals(version, entry.version())) {
                throw new RepositoryVersionExistsException("TOOL", repositoryId, toolId, version);
            }
        }
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
            String scriptId = catalog.normalizeNullable(matcher.group(2));
            if (scriptId != null) {
                dependencies.add(scriptId);
            }
        }
        return List.copyOf(dependencies);
    }
}
