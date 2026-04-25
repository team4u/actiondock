package org.team4u.scriptflow.repository;

import org.team4u.scriptflow.application.ConfigValueApplicationService;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.config.AppProperties;
import org.team4u.scriptflow.domain.model.ConfigPublishMode;
import org.team4u.scriptflow.domain.model.ConfigValue;
import org.team4u.scriptflow.domain.model.PublishedScriptSnapshot;
import org.team4u.scriptflow.domain.model.RepositoryDefinition;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptSchedule;
import org.team4u.scriptflow.domain.model.ScriptScope;
import org.team4u.scriptflow.domain.model.ScriptStatus;
import org.team4u.scriptflow.domain.model.ScriptType;
import org.team4u.scriptflow.domain.model.RepositoryToolInstallation;
import org.team4u.scriptflow.domain.port.ConfigValueRepository;
import org.team4u.scriptflow.domain.port.JsonCodec;
import org.team4u.scriptflow.domain.port.RepositoryDefinitionRepository;
import org.team4u.scriptflow.domain.port.ScriptRepository;
import org.team4u.scriptflow.domain.port.ScriptScheduleRepository;
import org.team4u.scriptflow.domain.port.RepositoryToolInstallationRepository;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * 仓库发现、安装、更新和发布服务。
 *
 * @author jay.wu
 */
public class RepositoryCatalogService {
    private static final String REPOSITORY_INDEX_FILE = "scriptflow.repository.json";

    private final RepositoryDefinitionRepository repositoryDefinitionRepository;
    private final RepositoryToolInstallationRepository repositoryToolInstallationRepository;
    private final ScriptRepository scriptRepository;
    private final ScriptScheduleRepository scriptScheduleRepository;
    private final ConfigValueRepository configValueRepository;
    private final ScriptApplicationService scriptApplicationService;
    private final ConfigValueApplicationService configValueApplicationService;
    private final JsonCodec jsonCodec;
    private final HttpClient httpClient;
    private final Path repositoriesRoot;

    public RepositoryCatalogService(RepositoryDefinitionRepository repositoryDefinitionRepository,
                                    RepositoryToolInstallationRepository repositoryToolInstallationRepository,
                                    ScriptRepository scriptRepository,
                                    ScriptScheduleRepository scriptScheduleRepository,
                                    ConfigValueRepository configValueRepository,
                                    ScriptApplicationService scriptApplicationService,
                                    ConfigValueApplicationService configValueApplicationService,
                                    JsonCodec jsonCodec,
                                    AppProperties properties) {
        this.repositoryDefinitionRepository = repositoryDefinitionRepository;
        this.repositoryToolInstallationRepository = repositoryToolInstallationRepository;
        this.scriptRepository = scriptRepository;
        this.scriptScheduleRepository = scriptScheduleRepository;
        this.configValueRepository = configValueRepository;
        this.scriptApplicationService = scriptApplicationService;
        this.configValueApplicationService = configValueApplicationService;
        this.jsonCodec = jsonCodec;
        this.httpClient = HttpClient.newHttpClient();
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
        String alias = normalize(target.getAlias(), "仓库别名不能为空").toLowerCase(Locale.ROOT);
        String type = normalizeOrDefault(target.getType(), "GIT").toUpperCase(Locale.ROOT);
        if (!List.of("GIT", "HTTP", "LOCAL_DIR").contains(type)) {
            throw new IllegalArgumentException("仓库类型仅支持 GIT / HTTP / LOCAL_DIR");
        }
        String trustLevel = normalizeOrDefault(target.getTrustLevel(), "UNTRUSTED").toUpperCase(Locale.ROOT);
        if (!List.of("TRUSTED", "UNTRUSTED").contains(trustLevel)) {
            throw new IllegalArgumentException("trustLevel 仅支持 TRUSTED / UNTRUSTED");
        }

        LocalDateTime now = LocalDateTime.now();
        RepositoryDefinition existing = repositoryDefinitionRepository.findById(id).orElse(null);
        RepositoryDefinition value = new RepositoryDefinition()
                .setId(id)
                .setName(normalize(target.getName(), "仓库名称不能为空"))
                .setAlias(alias)
                .setType(type)
                .setUrl(normalize(target.getUrl(), "仓库地址不能为空"))
                .setBranch("GIT".equals(type) ? normalizeOrDefault(target.getBranch(), "main") : null)
                .setEnabled(target.isEnabled())
                .setTrustLevel(trustLevel)
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
        for (RepositoryIndexEntry entry : index.tools()) {
            ToolFile tool = readToolFile(repository, entry.toolPath());
            tools.add(toDescriptor(repository, tool, entry.toolPath()));
        }
        return tools.stream()
                .sorted(Comparator.comparing(RepositoryToolDescriptor::installedScriptId))
                .toList();
    }

    public RepositoryToolDetail getRepositoryTool(String repositoryId, String toolId) {
        RepositoryDefinition repository = getRepository(repositoryId);
        RepositoryIndexFile index = readRepositoryIndex(repository);
        RepositoryIndexEntry entry = index.tools().stream()
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
        return installOrUpdateTool(repositoryId, toolId, installSchedules, false);
    }

    public RepositoryToolInstallation updateTool(String repositoryId, String toolId, boolean installSchedules) {
        return installOrUpdateTool(repositoryId, toolId, installSchedules, true);
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

        ScriptDefinition script = scriptApplicationService.getPublished(normalize(request.scriptId(), "scriptId 不能为空"));
        String toolId = normalize(request.toolId(), "toolId 不能为空");
        Path root = resolveRepositoryRoot(repository);
        Path toolDir = root.resolve("tools").resolve(toolId);
        writeToolFiles(toolDir, toolId, script, request);
        updateRepositoryIndex(root, repository, toolId, script, request);

        if ("GIT".equals(repository.getType())) {
            commitAndPush(repository, toolId, request.version());
        }
        return getRepositoryTool(repositoryId, toolId).descriptor();
    }

    private RepositoryToolInstallation installOrUpdateTool(String repositoryId,
                                                     String toolId,
                                                     boolean installSchedules,
                                                     boolean updateOnly) {
        RepositoryToolDetail detail = getRepositoryTool(repositoryId, toolId);
        String installedScriptId = detail.descriptor().installedScriptId();
        ScriptDefinition existing = scriptRepository.findById(installedScriptId).orElse(null);
        if (updateOnly && existing == null) {
            throw new IllegalArgumentException("工具尚未安装: " + installedScriptId);
        }

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

    private ToolFile buildToolFile(ScriptDefinition script,
                                   RepositoryPublishRequest request,
                                   String sourceFileName) {
        return new ToolFile(
                1,
                normalize(request.toolId(), "toolId 不能为空"),
                normalizeOrDefault(request.displayName(), script.getName()),
                normalize(request.version(), "version 不能为空"),
                script.getType().name(),
                normalizeNullable(request.description()),
                normalizeNullable(request.owner()),
                request.tags() == null ? List.of() : request.tags(),
                sourceFileName,
                "input.schema.json",
                "output.schema.json",
                request.configItems() == null || request.configItems().isEmpty() ? null : "config.template.json",
                request.scheduleIds() == null || request.scheduleIds().isEmpty() ? null : "schedules.template.json",
                null,
                null
        );
    }

    private List<ConfigTemplateItem> buildConfigTemplate(RepositoryPublishRequest request) {
        List<ConfigTemplateItem> templates = new ArrayList<>();
        for (RepositoryPublishConfigItem item : request.configItems() == null ? List.<RepositoryPublishConfigItem>of() : request.configItems()) {
            ConfigValue value = configValueApplicationService.get(item.key());
            boolean inline = "INLINE".equalsIgnoreCase(item.publishMode());
            templates.add(new ConfigTemplateItem(
                    value.getKey(),
                    value.getDescription(),
                    "string",
                    false,
                    !inline,
                    inline ? value.getValue() : null
            ));
        }
        return templates;
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
                : new RepositoryIndexFile(1, repository.getName(), repository.getDescription(), new ArrayList<>());
        List<RepositoryIndexEntry> entries = new ArrayList<>(current.tools() == null ? List.of() : current.tools());
        RepositoryIndexEntry next = new RepositoryIndexEntry(
                toolId,
                normalizeOrDefault(request.displayName(), script.getName()),
                normalize(request.version(), "version 不能为空"),
                script.getType().name(),
                normalizeNullable(request.description()),
                "tools/" + toolId + "/tool.json"
        );
        entries.removeIf(item -> toolId.equals(item.id()));
        entries.add(next);
        entries.sort(Comparator.comparing(RepositoryIndexEntry::id));
        writeJson(root.resolve(REPOSITORY_INDEX_FILE), new RepositoryIndexFile(
                1,
                repository.getName(),
                normalizeNullable(repository.getDescription()),
                entries
        ));
    }

    private void commitAndPush(RepositoryDefinition repository, String toolId, String version) {
        Path root = resolveRepositoryRoot(repository);
        runGit(root, List.of("git", "-C", root.toString(), "add", "."));
        runGit(root, List.of("git", "-C", root.toString(), "commit", "-m", "publish(" + toolId + "): " + version), true);
        runGit(root, List.of("git", "-C", root.toString(), "push", "origin", normalizeOrDefault(repository.getBranch(), "main")));
    }

    private Map<String, Object> readSchema(String repositoryId, String schemaPath) {
        if (schemaPath == null || schemaPath.isBlank()) {
            return Map.of();
        }
        return readJsonObject(readRepositoryFile(getRepository(repositoryId), Path.of(schemaPath)));
    }

    private RepositoryToolDescriptor toDescriptor(RepositoryDefinition repository, ToolFile tool, String toolPath) {
        String installedScriptId = repository.getAlias() + "." + tool.id();
        RepositoryToolInstallation installation = repositoryToolInstallationRepository.findByToolId(installedScriptId).orElse(null);
        return new RepositoryToolDescriptor(
                repository.getId(),
                repository.getAlias(),
                tool.id(),
                installedScriptId,
                tool.name(),
                tool.version(),
                tool.description(),
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
                installation != null,
                installation == null ? null : installation.getVersion(),
                installation != null && !Objects.equals(installation.getVersion(), tool.version()),
                "TRUSTED".equalsIgnoreCase(repository.getTrustLevel())
        );
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
                    normalizeOrDefault(repository.getName(), repository.getAlias()),
                    normalizeNullable(repository.getDescription()),
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
            return jsonCodec.read(new String(stream.readAllBytes(), StandardCharsets.UTF_8), type);
        } catch (IOException exception) {
            throw new IllegalStateException("读取仓库文件失败: " + path, exception);
        }
    }

    private <T> T readHttpJson(String url, Class<T> type) {
        String text = readHttpText(url);
        return jsonCodec.read(text, type);
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
            String repositoryAlias,
            String toolId,
            String installedScriptId,
            String displayName,
            String version,
            String description,
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
            boolean installed,
            String installedVersion,
            boolean updateAvailable,
            boolean trusted
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
            String description,
            List<String> tags,
            List<String> scheduleIds,
            List<RepositoryPublishConfigItem> configItems
    ) {
    }

    public record RepositoryPublishConfigItem(String key, String publishMode) {
    }

    public record RepositoryIndexFile(int repositoryVersion,
                                      String name,
                                      String description,
                                      List<RepositoryIndexEntry> tools) {
    }

    public record RepositoryIndexEntry(String id,
                                       String name,
                                       String version,
                                       String type,
                                       String description,
                                       String toolPath) {
    }

    public record ToolFile(int toolVersion,
                           String id,
                           String name,
                           String version,
                           String type,
                           String description,
                           String owner,
                           List<String> tags,
                           String sourcePath,
                           String inputSchemaPath,
                           String outputSchemaPath,
                           String configTemplatePath,
                           String scheduleTemplatePath,
                           String digest,
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
}
