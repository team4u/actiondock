package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.exception.UpstreamConflictException;
import org.team4u.actiondock.domain.exception.RepositoryVersionExistsException;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.RepositoryLocalAssetMode;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.plugin.PluginReferenceSourceType;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.plugin.PluginSummaryView;
import org.team4u.actiondock.skill.SkillFileUtils;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;
import org.team4u.actiondock.common.NormalizeUtils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 仓库工具发布处理器。
 * <p>
 * 负责将本地脚本发布为仓库工具的全部逻辑，包括：
 * 文件写入、依赖解析、索引更新、上游安全检查、版本冲突检测。
 *
 * @author jay.wu
 */
final class ScriptRepositoryPublisher {
    private static final Pattern PLUGIN_INVOKE_PATTERN = Pattern.compile(
            "plugins\\s*\\.\\s*invoke\\s*\\(\\s*([\"'`])([^\"'`]+)\\1\\s*,\\s*([\"'`])([^\"'`]+)\\3"
    );
    private static final Pattern SCRIPT_INVOKE_ANY_PATTERN = Pattern.compile(
            "scripts\\s*\\.\\s*invoke\\s*\\("
    );
    private static final String TOOL_SOURCE_PYTHON_FILE = "source.py";
    private static final String TOOL_SOURCE_GROOVY_FILE = "source.groovy";
    private static final String TOOL_REQUIREMENTS_FILE = "requirements.txt";
    private static final String TOOL_INPUT_SCHEMA_FILE = "input.schema.json";
    private static final String TOOL_OUTPUT_SCHEMA_FILE = "output.schema.json";
    private static final String TOOL_CONFIG_TEMPLATE_FILE = "config.template.json";
    private static final String TOOL_SCHEDULE_TEMPLATE_FILE = "schedules.template.json";

    private final RepositoryCatalogService catalog;
    private final RepositoryCatalogService.Repositories repos;
    private final RepositoryCatalogService.ApplicationServices services;

    ScriptRepositoryPublisher(RepositoryCatalogService catalog,
                            RepositoryCatalogService.Repositories repos,
                            RepositoryCatalogService.ApplicationServices services) {
        this.catalog = catalog;
        this.repos = repos;
        this.services = services;
    }

    RepositoryScriptDescriptor publish(String repositoryId, RepositoryPublishRequest request) {
        WritableRepositorySession session = catalog.openWritableRepositorySession(repositoryId);
        RepositoryDefinition repository = session.repository();

        ScriptDefinition sourceScript = catalog.scriptApplicationService().get(NormalizeUtils.normalize(request.scriptId(), "scriptId 不能为空"));
        RepositoryLocalAsset upstreamBinding = repos.repositoryLocalAssetRepository()
                .findByLocalAsset(UpstreamAssetType.SCRIPT, sourceScript.getId())
                .filter(asset -> asset.getMode() == RepositoryLocalAssetMode.TRACKED)
                .orElse(null);
        if (upstreamBinding != null && Objects.equals(upstreamBinding.getRepositoryId(), repositoryId) && !request.force()) {
            assertUpstreamPublishSafe(sourceScript, repository, upstreamBinding);
        }

        ScriptDefinition script = catalog.scriptApplicationService().getPublished(sourceScript.getId());
        catalog.assertPackagingConstraints(script);

        String toolId = NormalizeUtils.normalize(request.repositoryScriptId(), "scriptId 不能为空");
        String version = NormalizeUtils.normalize(request.version(), SkillFileUtils.ERR_VERSION_REQUIRED);
        List<ScriptSchedule> selectedSchedules = RepositoryCatalogTypes.resolvePublishSchedules(script.getId(), request.scheduleIds(), repos.scriptScheduleRepository());
        List<ScriptDependency> scriptDependencies = resolveToolScriptDependencies(repositoryId, script, request);
        RepositoryPublishConfigResolver.PublishConfigResolution configResolution = RepositoryPublishConfigResolver.resolve(
                script.getSource(),
                selectedSchedules.stream().map(ScriptSchedule::getInput).toList(),
                catalog.configValueRepository().findAll()
        );
        List<ConfigTemplateItem> configTemplates = RepositoryPublishConfigResolver.buildTemplates(configResolution, request.configItems());
        List<ScheduleTemplateItem> scheduleTemplates = buildScheduleTemplate(selectedSchedules);

        assertToolVersionAvailable(repositoryId, session.index(), toolId, version);
        Path toolDir = session.root().resolve(SCRIPTS_DIR).resolve(toolId);
        writeToolFiles(toolDir, toolId, script, request, configTemplates, scheduleTemplates, scriptDependencies);
        session.commitPublishedAsset(toolId, version, request.releaseNotes());
        catalog.refreshRepositoryCache(repositoryId);

        RepositoryScriptDetail publishedDetail = catalog.getRepositoryScript(repositoryId, toolId);
        if (upstreamBinding != null
                && Objects.equals(upstreamBinding.getRepositoryId(), repositoryId)
                && Objects.equals(upstreamBinding.getUpstreamAssetId(), toolId)) {
            updateTrackedLocalAsset(upstreamBinding, publishedDetail);
        }
        return publishedDetail.descriptor();
    }

    private void assertUpstreamPublishSafe(ScriptDefinition script, RepositoryDefinition repository, RepositoryLocalAsset binding) {
        RepositoryScriptDetail detail = catalog.getRepositoryScript(repository.getId(), binding.getUpstreamAssetId());
        ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        UpstreamSyncState syncState = UpstreamSyncService.resolveSyncState(binding, catalog.computeWorkingCopyLocalDigest(script), state);
        if (syncState == UpstreamSyncState.REMOTE_CHANGES || syncState == UpstreamSyncState.DIVERGED) {
            throw new UpstreamConflictException(script.getId(), binding.getRepositoryId(), binding.getUpstreamAssetId());
        }
    }

    private void updateTrackedLocalAsset(RepositoryLocalAsset binding, RepositoryScriptDetail detail) {
        ToolSourceState state = catalog.resolveToolSourceState(catalog.getRepository(binding.getRepositoryId()), detail);
        repos.repositoryLocalAssetRepository().save(binding
                .setVersion(detail.descriptor().version())
                .setLatestVersion(detail.descriptor().version())
                .setSourcePath(state.path())
                .setBaseCommit(state.commit())
                .setBaseDigest(state.digest())
                .setLastSyncedAt(LocalDateTime.now())
                .setUpdatedAt(LocalDateTime.now()));
    }

    private void writeToolFiles(Path toolDir,
                                String toolId,
                                ScriptDefinition script,
                                RepositoryPublishRequest request,
                                List<ConfigTemplateItem> configTemplates,
                                List<ScheduleTemplateItem> scheduleTemplates,
                                List<ScriptDependency> scriptDependencies) {
        try {
            Files.createDirectories(toolDir);
            String sourceFileName = script.getType() == ScriptType.PYTHON ? TOOL_SOURCE_PYTHON_FILE : TOOL_SOURCE_GROOVY_FILE;
            List<PluginDependency> pluginDeps = resolveToolPluginDependencies(script);
            writeToolSourceFiles(toolDir, script, sourceFileName);
            writeToolDescriptorFile(toolDir, script, request, sourceFileName, configTemplates, scheduleTemplates, scriptDependencies, pluginDeps);
            writeToolOptionalFiles(toolDir, configTemplates, scheduleTemplates);
        } catch (IOException exception) {
            throw new IllegalStateException("写入仓库工具文件失败", exception);
        }
    }

    private static void writeToolSourceFiles(Path toolDir, ScriptDefinition script, String sourceFileName) throws IOException {
        Files.writeString(toolDir.resolve(sourceFileName), script.getSource(), StandardCharsets.UTF_8);
        if (script.getPythonRequirements() != null
                && !script.getPythonRequirements().isBlank()) {
            Files.writeString(toolDir.resolve(TOOL_REQUIREMENTS_FILE), script.getPythonRequirements(), StandardCharsets.UTF_8);
        }
    }

    private void writeToolDescriptorFile(Path toolDir,
                                          ScriptDefinition script,
                                          RepositoryPublishRequest request,
                                          String sourceFileName,
                                          List<ConfigTemplateItem> configTemplates,
                                          List<ScheduleTemplateItem> scheduleTemplates,
                                          List<ScriptDependency> scriptDependencies,
                                          List<PluginDependency> pluginDeps) {
        catalog.writeJson(toolDir.resolve(SCRIPT_DESCRIPTOR_FILE), buildToolFile(script, request, sourceFileName, configTemplates, scheduleTemplates, scriptDependencies, pluginDeps));
        catalog.writeJson(toolDir.resolve(TOOL_INPUT_SCHEMA_FILE), script.getInputSchema());
        catalog.writeJson(toolDir.resolve(TOOL_OUTPUT_SCHEMA_FILE), script.getOutputSchema());
    }

    private void writeToolOptionalFiles(Path toolDir,
                                         List<ConfigTemplateItem> configTemplates,
                                         List<ScheduleTemplateItem> scheduleTemplates) {
        if (!configTemplates.isEmpty()) {
            catalog.writeJson(toolDir.resolve(TOOL_CONFIG_TEMPLATE_FILE), configTemplates);
        }
        if (!scheduleTemplates.isEmpty()) {
            catalog.writeJson(toolDir.resolve(TOOL_SCHEDULE_TEMPLATE_FILE), scheduleTemplates);
        }
    }

    static ToolFile buildToolFile(ScriptDefinition script,
                                  RepositoryPublishRequest request,
                                  String sourceFileName,
                                  List<ConfigTemplateItem> configTemplates,
                                  List<ScheduleTemplateItem> scheduleTemplates,
                                  List<ScriptDependency> scriptDependencies,
                                  List<PluginDependency> pluginDependencies) {
        return new ToolFile(
                RepositoryIndexUtils.DEFAULT_VERSION,
                NormalizeUtils.normalize(request.repositoryScriptId(), "scriptId 不能为空"),
                NormalizeUtils.normalizeOrDefault(request.displayName(), script.getName()),
                NormalizeUtils.normalize(request.version(), SkillFileUtils.ERR_VERSION_REQUIRED),
                script.getType().name(),
                script.getPackaging().name(),
                NormalizeUtils.normalizeNullable(script.getDescription()),
                NormalizeUtils.normalizeNullable(request.releaseNotes()),
                NormalizeUtils.normalizeNullable(request.owner()),
                NormalizeUtils.nullSafeList(request.tags()),
                sourceFileName,
                NormalizeUtils.isBlank(script.getPythonRequirements())
                        ? null
                        : TOOL_REQUIREMENTS_FILE,
                TOOL_INPUT_SCHEMA_FILE,
                TOOL_OUTPUT_SCHEMA_FILE,
                configTemplates.isEmpty() ? null : TOOL_CONFIG_TEMPLATE_FILE,
                scheduleTemplates.isEmpty() ? null : TOOL_SCHEDULE_TEMPLATE_FILE,
                null,
                null,
                scriptDependencies,
                pluginDependencies
        );
    }

    private List<PluginDependency> resolveToolPluginDependencies(ScriptDefinition script) {
        return resolvePluginDependenciesForDigest(services.pluginRuntimeService(), script);
    }

    static List<PluginDependency> resolvePluginDependenciesForDigest(PluginRuntimeService pluginRuntimeService,
                                                                     ScriptDefinition script) {
        Map<String, String> installedPluginVersions = new LinkedHashMap<>();
        Set<String> systemPluginIds = new LinkedHashSet<>();
        for (PluginSummaryView plugin : pluginRuntimeService.list()) {
            if (plugin.getSourceType() == PluginReferenceSourceType.SYSTEM) {
                systemPluginIds.add(plugin.getPluginId());
                continue;
            }
            installedPluginVersions.put(plugin.getPluginId(), plugin.getVersion());
        }
        Map<String, PluginDependency> dependencies = new LinkedHashMap<>();
        mergePluginDependencies(dependencies, script.getPluginDependencies());
        mergePluginDependencies(
                dependencies,
                extractPluginDependenciesFromSource(script.getSource(), installedPluginVersions, systemPluginIds)
        );
        return List.copyOf(dependencies.values());
    }

    private List<ScriptDependency> resolveToolScriptDependencies(String defaultRepositoryId,
                                                                   ScriptDefinition script,
                                                                   RepositoryPublishRequest request) {
        String source = script.getSource();
        assertLiteralScriptInvocations(source);
        List<String> detectedScriptIds = AiPackageIdRewriter.extractScriptDependenciesFromSource(source);
        if (detectedScriptIds.isEmpty()) {
            return List.of();
        }

        Map<String, ScriptDependency> declaredByScriptId = buildDeclaredDependencyMap(defaultRepositoryId, request.scriptDependencies());
        assertDeclaredMatchesDetected(declaredByScriptId, detectedScriptIds);

        List<ScriptDependency> dependencies = new ArrayList<>();
        for (String scriptId : detectedScriptIds) {
            dependencies.add(declaredByScriptId.get(scriptId));
        }
        return List.copyOf(dependencies);
    }

    static void assertLiteralScriptInvocations(String source) {
        int invocationCount = NormalizeUtils.isBlank(source) ? 0 : (int) SCRIPT_INVOKE_ANY_PATTERN.matcher(source).results().count();
        int literalInvocationCount = AiPackageIdRewriter.countLiteralScriptInvocations(source);
        if (invocationCount != literalInvocationCount) {
            throw new IllegalArgumentException("仓库发布仅支持字面量 scripts.invoke(...) 依赖，请先移除动态脚本调用");
        }
    }

    private Map<String, ScriptDependency> buildDeclaredDependencyMap(String defaultRepositoryId,
                                                                     List<ScriptDependency> declaredDependencies) {
        Map<String, ScriptDependency> declaredByScriptId = new LinkedHashMap<>();
        for (ScriptDependency item : NormalizeUtils.nullSafeList(declaredDependencies)) {
            String scriptId = NormalizeUtils.normalize(item.getScriptId(), "脚本依赖 scriptId 不能为空");
            if (declaredByScriptId.containsKey(scriptId)) {
                throw new IllegalArgumentException("脚本依赖重复声明: " + scriptId);
            }
            String repositoryId = NormalizeUtils.normalizeOrDefault(item.getRepositoryId(), defaultRepositoryId);
            String toolId = NormalizeUtils.normalize(item.getRepositoryScriptId(), "脚本依赖 scriptId 不能为空: " + scriptId);
            RepositoryScriptDescriptor descriptor = catalog.getRepositoryScript(repositoryId, toolId).descriptor();
            declaredByScriptId.put(scriptId, new ScriptDependency()
                    .setScriptId(scriptId)
                    .setRepositoryId(repositoryId)
                    .setRepositoryScriptId(toolId)
                    .setVersionRange(NormalizeUtils.normalizeOrDefault(item.getVersionRange(), ">= " + descriptor.version())));
        }
        return declaredByScriptId;
    }

    private static void assertDeclaredMatchesDetected(Map<String, ScriptDependency> declaredByScriptId,
                                                      List<String> detectedScriptIds) {
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
    }

    static List<PluginDependency> extractPluginDependenciesFromSource(String source, Map<String, String> installedPluginVersions) {
        return extractPluginDependenciesFromSource(source, installedPluginVersions, Set.of());
    }

    static List<PluginDependency> extractPluginDependenciesFromSource(String source,
                                                                      Map<String, String> installedPluginVersions,
                                                                      Set<String> excludedPluginIds) {
        if (NormalizeUtils.isBlank(source)) {
            return List.of();
        }

        Map<String, LinkedHashSet<String>> actionsByPlugin = new LinkedHashMap<>();
        Matcher matcher = PLUGIN_INVOKE_PATTERN.matcher(source);
        while (matcher.find()) {
            String pluginId = matcher.group(2).trim();
            String action = matcher.group(4).trim();
            if (pluginId.isBlank() || action.isBlank() || excludedPluginIds.contains(pluginId)) {
                continue;
            }
            actionsByPlugin.computeIfAbsent(pluginId, ignored -> new LinkedHashSet<>()).add(action);
        }

        List<PluginDependency> dependencies = new ArrayList<>();
        for (Map.Entry<String, LinkedHashSet<String>> entry : actionsByPlugin.entrySet()) {
            String version = installedPluginVersions == null ? null : installedPluginVersions.get(entry.getKey());
            dependencies.add(new PluginDependency()
                    .setPluginId(entry.getKey())
                    .setVersionRange(NormalizeUtils.isBlank(version) ? null : ">= " + version)
                    .setRequiredActions(new ArrayList<>(entry.getValue())));
        }
        return dependencies;
    }

    private static void mergePluginDependencies(Map<String, PluginDependency> target, List<PluginDependency> source) {
        for (PluginDependency dependency : NormalizeUtils.nullSafeList(source)) {
            if (NormalizeUtils.isBlank(dependency.getPluginId())) {
                continue;
            }
            PluginDependency existing = target.computeIfAbsent(dependency.getPluginId(), pluginId -> new PluginDependency()
                    .setPluginId(pluginId)
                    .setRequiredActions(List.of()));
            if ((NormalizeUtils.isBlank(existing.getVersionRange()))
                    && NormalizeUtils.isNotBlank(dependency.getVersionRange())) {
                existing.setVersionRange(dependency.getVersionRange());
            }
            LinkedHashSet<String> actions = new LinkedHashSet<>(existing.getRequiredActions());
            actions.addAll(dependency.getRequiredActions());
            existing.setRequiredActions(new ArrayList<>(actions));
        }
    }

    private static List<ScheduleTemplateItem> buildScheduleTemplate(List<ScriptSchedule> schedules) {
        List<ScheduleTemplateItem> templates = new ArrayList<>();
        for (ScriptSchedule schedule : NormalizeUtils.nullSafeList(schedules)) {
            templates.add(new ScheduleTemplateItem(schedule.getId(), schedule.getScriptId(), schedule.getName(), schedule.getCronExpression(), schedule.getInput(), false));
        }
        return templates;
    }

    static void assertToolVersionAvailable(String repositoryId,
                                           RepositoryIndexFile index,
                                           String toolId,
                                           String version) {
        NormalizeUtils.nullSafeList(index == null ? null : index.scripts()).stream()
                .filter(entry -> Objects.equals(toolId, entry.id()) && Objects.equals(version, entry.version()))
                .findFirst()
                .ifPresent(entry -> { throw new RepositoryVersionExistsException(ASSET_TYPE_TOOL, repositoryId, toolId, version); });
    }
}
