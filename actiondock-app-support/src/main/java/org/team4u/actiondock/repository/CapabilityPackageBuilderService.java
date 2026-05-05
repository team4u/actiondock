package org.team4u.actiondock.repository;

import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.domain.model.ExecutionPreset;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.ExecutionPresetRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.skill.SkillFileUtils;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

/**
 * 能力包草稿构建与发布预览服务。
 * <p>
 * 从 {@link RepositoryCatalogService} 中提取，负责构建能力包草稿（draft）、
 * 配置模板、调度模板、预设模板，以及生成发布预览（publish preview）。
 *
 * @author jay.wu
 */
class CapabilityPackageBuilderService {

    private static final String ERR_UNSUPPORTED_ENTRY_TYPE = "当前仅支持 AGENT / SCRIPT 入口";

    private final ScriptRepository scriptRepository;
    private final ScriptScheduleRepository scriptScheduleRepository;
    private final ExecutionPresetRepository executionPresetRepository;
    private final ConfigValueRepository configValueRepository;
    private final AiAgentProfileRepository aiAgentProfileRepository;
    private final AiPackageDependencyCollector aiPackageDependencyCollector;

    CapabilityPackageBuilderService(ScriptRepository scriptRepository,
                                    ScriptScheduleRepository scriptScheduleRepository,
                                    ExecutionPresetRepository executionPresetRepository,
                                    ConfigValueRepository configValueRepository,
                                    AiAgentProfileRepository aiAgentProfileRepository,
                                    AiPackageDependencyCollector aiPackageDependencyCollector) {
        this.scriptRepository = scriptRepository;
        this.scriptScheduleRepository = scriptScheduleRepository;
        this.executionPresetRepository = executionPresetRepository;
        this.configValueRepository = configValueRepository;
        this.aiAgentProfileRepository = aiAgentProfileRepository;
        this.aiPackageDependencyCollector = aiPackageDependencyCollector;
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
                            .map(key -> new RepositoryPublishConfigItem(key, PUBLISH_MODE_PLACEHOLDER))
                            .toList()
            )) {
                templates.putIfAbsent(item.key(), item);
            }
        }
        return templates.values().stream()
                .sorted(Comparator.comparing(ConfigTemplateItem::key))
                .toList();
    }

    CapabilityPackageDraft buildCapabilityPackageDraft(RepositoryDefinition repository,
                                                               RepositoryCatalogTypes.CapabilityPackagePublishRequest request) {
        return buildCapabilityPackageDraft(
                repository,
                request.packageId(),
                request.displayName(),
                request.version(),
                request.owner(),
                request.description(),
                request.releaseNotes(),
                request.tags(),
                request.riskLevel(),
                request.source(),
                request.primaryEntry(),
                request.scriptIds(),
                request.agentIds(),
                request.modelIds(),
                request.toolsetIds()
        );
    }


    CapabilityPackageDraft buildCapabilityPackageDraft(RepositoryDefinition repository,
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
        String packageId = SkillFileUtils.normalize(packageIdValue, "packageId 不能为空");
        String version = SkillFileUtils.normalize(versionValue, SkillFileUtils.ERR_VERSION_REQUIRED);
        CapabilityPackageSource sourceType = source == null ? CapabilityPackageSource.MANUAL : source;
        CapabilityPackageEntrySelection entry = primaryEntry;
        if (entry == null) {
            throw new IllegalArgumentException("primaryEntry 不能为空");
        }
        String entryType = SkillFileUtils.normalize(entry.type(), "entry.type 不能为空").toUpperCase(Locale.ROOT);
        String entryTargetId = SkillFileUtils.normalize(entry.targetId(), "entry.targetId 不能为空");
        String builderEntryAgentId = ENTRY_TYPE_AGENT.equals(entryType) ? entryTargetId : packageId + ".entry";
        AiPackageBundleBuilder builder = new AiPackageBundleBuilder(repository, packageId, builderEntryAgentId);

        if (ENTRY_TYPE_AGENT.equals(entryType)) {
            aiPackageDependencyCollector.collectAgentDependency(repository, builder, entryTargetId, true);
        } else if (ENTRY_TYPE_SCRIPT.equals(entryType)) {
            aiPackageDependencyCollector.collectScriptDependency(repository, builder, entryTargetId);
        } else {
            throw new IllegalArgumentException(ERR_UNSUPPORTED_ENTRY_TYPE);
        }

        collectDependencies(repository, builder, scriptIds, agentIds, modelIds, toolsetIds);

        AiPackageBundle bundle = builder.build();
        return buildDraftFromBundle(
                packageId, version, owner, displayNameValue, descriptionValue, releaseNotes,
                tags, riskLevel, sourceType, entry, scriptIds, agentIds, bundle
        );
    }

    private CapabilityPackageDraft buildDraftFromBundle(String packageId,
                                                        String version,
                                                        String owner,
                                                        String displayNameValue,
                                                        String descriptionValue,
                                                        String releaseNotes,
                                                        List<String> tags,
                                                        String riskLevel,
                                                        CapabilityPackageSource sourceType,
                                                        CapabilityPackageEntrySelection entry,
                                                        List<String> scriptIds,
                                                        List<String> agentIds,
                                                        AiPackageBundle bundle) {
        List<ConfigTemplateItem> configTemplate = buildAiPackageConfigTemplate(bundle);
        List<ScheduleTemplateItem> scheduleTemplate = buildCapabilityPackageScheduleTemplate(bundle);
        List<CapabilityPackagePresetTemplate> presetTemplate = buildCapabilityPackagePresetTemplate(bundle);
        List<CapabilityPackageEntryFile> entries = buildCapabilityPackageEntries(entry, bundle, scriptIds, agentIds);
        String displayName = SkillFileUtils.normalizeOrDefault(displayNameValue, resolveCapabilityPackageDisplayName(entry, bundle));
        String description = SkillFileUtils.normalizeNullable(descriptionValue == null ? resolveCapabilityPackageDescription(entry, bundle) : descriptionValue);
        return new CapabilityPackageDraft(
                packageId,
                displayName,
                version,
                SkillFileUtils.normalizeNullable(owner),
                description,
                SkillFileUtils.normalizeNullable(releaseNotes),
                tags == null ? List.of() : tags.stream().map(SkillFileUtils::normalizeNullable).filter(Objects::nonNull).distinct().toList(),
                SkillFileUtils.normalizeNullable(riskLevel),
                sourceType,
                entries,
                bundle,
                configTemplate,
                scheduleTemplate,
                presetTemplate
        );
    }

    private void collectDependencies(RepositoryDefinition repository,
                                     AiPackageBundleBuilder builder,
                                     List<String> scriptIds,
                                     List<String> agentIds,
                                     List<String> modelIds,
                                     List<String> toolsetIds) {
        for (String scriptId : scriptIds == null ? List.<String>of() : scriptIds) {
            aiPackageDependencyCollector.collectScriptDependency(repository, builder, SkillFileUtils.normalize(scriptId, "scriptId 不能为空"));
        }
        for (String agentId : agentIds == null ? List.<String>of() : agentIds) {
            aiPackageDependencyCollector.collectAgentDependency(repository, builder, SkillFileUtils.normalize(agentId, "agentId 不能为空"), false);
        }
        for (String modelId : modelIds == null ? List.<String>of() : modelIds) {
            aiPackageDependencyCollector.collectModelDependency(builder, SkillFileUtils.normalize(modelId, "modelId 不能为空"));
        }
        for (String toolsetId : toolsetIds == null ? List.<String>of() : toolsetIds) {
            aiPackageDependencyCollector.collectToolsetDependency(repository, builder, SkillFileUtils.normalize(toolsetId, "toolsetId 不能为空"));
        }
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
                entries.putIfAbsent(ENTRY_TYPE_SCRIPT + ":" + scriptId, new CapabilityPackageEntryFile(
                        ENTRY_TYPE_SCRIPT,
                        scriptId,
                        script.getName(),
                        "script:" + scriptId
                ));
            }
        }
        for (String agentId : agentIds == null ? List.<String>of() : agentIds) {
            AiAgentProfile agent = aiAgentProfileRepository.findById(agentId).orElse(null);
            if (agent != null) {
                entries.putIfAbsent(ENTRY_TYPE_AGENT + ":" + agentId, new CapabilityPackageEntryFile(
                        ENTRY_TYPE_AGENT,
                        agentId,
                        agent.getName(),
                        "agent:" + agentId
                ));
            }
        }
        if (entries.isEmpty()) {
            if (!bundle.agents().isEmpty()) {
                AiPackageAgentFile agent = bundle.agents().values().iterator().next();
                entries.put(ENTRY_TYPE_AGENT + ":" + agent.id(), new CapabilityPackageEntryFile(ENTRY_TYPE_AGENT, agent.id(), agent.name(), "agent:" + agent.id()));
            } else if (!bundle.scripts().isEmpty()) {
                AiPackageScriptFile script = bundle.scripts().values().iterator().next();
                entries.put(ENTRY_TYPE_SCRIPT + ":" + script.id(), new CapabilityPackageEntryFile(ENTRY_TYPE_SCRIPT, script.id(), script.name(), "script:" + script.id()));
            }
        }
        return new ArrayList<>(entries.values());
    }

    private void addCapabilityPackageEntry(Map<String, CapabilityPackageEntryFile> entries,
                                           CapabilityPackageEntrySelection selection) {
        if (selection == null) {
            return;
        }
        String type = SkillFileUtils.normalize(selection.type(), "entry.type 不能为空").toUpperCase(Locale.ROOT);
        String targetId = SkillFileUtils.normalize(selection.targetId(), "entry.targetId 不能为空");
        String displayName = SkillFileUtils.normalizeNullable(selection.displayName());
        if (ENTRY_TYPE_AGENT.equals(type)) {
            AiAgentProfile agent = aiAgentProfileRepository.findById(targetId)
                    .orElseThrow(() -> new IllegalArgumentException("AI Agent Profile 不存在: " + targetId));
            entries.put(type + ":" + targetId, new CapabilityPackageEntryFile(type, targetId, SkillFileUtils.normalizeOrDefault(displayName, agent.getName()), "agent:" + targetId));
            return;
        }
        if (ENTRY_TYPE_SCRIPT.equals(type)) {
            ScriptDefinition script = scriptRepository.findById(targetId)
                    .orElseThrow(() -> new IllegalArgumentException("脚本不存在: " + targetId));
            entries.put(type + ":" + targetId, new CapabilityPackageEntryFile(type, targetId, SkillFileUtils.normalizeOrDefault(displayName, script.getName()), "script:" + targetId));
            return;
        }
        throw new IllegalArgumentException(ERR_UNSUPPORTED_ENTRY_TYPE);
    }

    private String resolveCapabilityPackageDisplayName(CapabilityPackageEntrySelection entry, AiPackageBundle bundle) {
        if (entry != null && entry.displayName() != null && !entry.displayName().isBlank()) {
            return entry.displayName().trim();
        }
        if (entry != null && ENTRY_TYPE_AGENT.equalsIgnoreCase(entry.type())) {
            return SkillFileUtils.normalizeOrDefault(bundle.entryAgentName(), entry.targetId());
        }
        if (entry != null && ENTRY_TYPE_SCRIPT.equalsIgnoreCase(entry.type())) {
            ScriptDefinition script = scriptRepository.findById(entry.targetId()).orElse(null);
            if (script != null) {
                return script.getName();
            }
        }
        return SkillFileUtils.normalizeOrDefault(bundle.entryAgentName(), "Capability Package");
    }

    private String resolveCapabilityPackageDescription(CapabilityPackageEntrySelection entry, AiPackageBundle bundle) {
        if (entry != null && ENTRY_TYPE_AGENT.equalsIgnoreCase(entry.type())) {
            return SkillFileUtils.normalizeNullable(bundle.entryAgentDescription());
        }
        if (entry != null && ENTRY_TYPE_SCRIPT.equalsIgnoreCase(entry.type())) {
            ScriptDefinition script = scriptRepository.findById(entry.targetId()).orElse(null);
            return script == null ? null : SkillFileUtils.normalizeNullable(script.getDescription());
        }
        return SkillFileUtils.normalizeNullable(bundle.entryAgentDescription());
    }

    private List<ScheduleTemplateItem> buildCapabilityPackageScheduleTemplate(AiPackageBundle bundle) {
        return buildCapabilityPackageTemplates(
                bundle,
                scriptScheduleRepository::findByScriptId,
                item -> {
                    ScriptSchedule s = (ScriptSchedule) item;
                    return new ScheduleTemplateItem(
                            s.getId(),
                            s.getScriptId(),
                            s.getName(),
                            s.getCronExpression(),
                            s.getInput(),
                            s.isEnabled()
                    );
                },
                ScheduleTemplateItem::name
        );
    }

    private List<CapabilityPackagePresetTemplate> buildCapabilityPackagePresetTemplate(AiPackageBundle bundle) {
        return buildCapabilityPackageTemplates(
                bundle,
                executionPresetRepository::findByScriptId,
                item -> {
                    ExecutionPreset p = (ExecutionPreset) item;
                    return new CapabilityPackagePresetTemplate(
                            p.getId(),
                            p.getScriptId(),
                            p.getName(),
                            p.getInput()
                    );
                },
                CapabilityPackagePresetTemplate::name
        );
    }

    /**
     * 通用能力包模板构建方法，提取调度模板和预设模板的共享迭代模式。
     *
     * @param bundle    AI 能力包数据
     * @param fetcher   根据脚本 ID 获取关联实体的函数
     * @param converter 将关联实体转换为模板对象的函数
     * @param nameExtractor 模板名称提取函数，用于排序
     * @param <T>       模板类型
     * @return 按名称排序的模板列表
     */
    @SuppressWarnings("unchecked")
    private <T> List<T> buildCapabilityPackageTemplates(AiPackageBundle bundle,
                                                        java.util.function.Function<String, List<?>> fetcher,
                                                        java.util.function.Function<Object, T> converter,
                                                        java.util.function.Function<T, String> nameExtractor) {
        List<T> templates = new ArrayList<>();
        for (String scriptId : bundle.scripts().keySet()) {
            for (Object item : fetcher.apply(scriptId)) {
                templates.add(converter.apply(item));
            }
        }
        return templates.stream()
                .sorted(Comparator.comparing(nameExtractor))
                .toList();
    }

    CapabilityPackagePublishPreview buildCapabilityPackagePublishPreview(RepositoryDefinition repository,
                                                                                CapabilityPackageDraft draft,
                                                                                CapabilityPackageDetail currentPackage) {
        List<CapabilityPackageCheck> checks = buildPublishChecks(draft);
        CapabilityPackageDiffSummary diff = computeEntryChanges(draft, currentPackage);

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
                diff
        );
    }

    private List<CapabilityPackageCheck> buildPublishChecks(CapabilityPackageDraft draft) {
        List<CapabilityPackageCheck> checks = new ArrayList<>();
        if (draft.entries().isEmpty()) {
            checks.add(new CapabilityPackageCheck(CHECK_SEVERITY_BLOCKER, "ENTRY_MISSING", "缺少主入口"));
        }
        if (draft.releaseNotes() == null || draft.releaseNotes().isBlank()) {
            checks.add(new CapabilityPackageCheck(CHECK_SEVERITY_WARNING, "RELEASE_NOTES_EMPTY", "未填写 release notes"));
        }
        for (RepositoryAiPackageDependency dependency : draft.bundle().externalDependencies().values()) {
            if ((dependency.version() == null || dependency.version().isBlank())
                    && !DependencyAssetType.AI_PACKAGE.name().equalsIgnoreCase(dependency.assetType())) {
                checks.add(new CapabilityPackageCheck(CHECK_SEVERITY_BLOCKER, "DEPENDENCY_VERSION_MISSING", "存在未声明版本的外部依赖: " + dependency.assetId()));
            } else if (DependencyAssetType.PLUGIN.name().equalsIgnoreCase(dependency.assetType())
                    && (dependency.repositoryId() == null || dependency.repositoryId().isBlank())) {
                checks.add(new CapabilityPackageCheck(CHECK_SEVERITY_WARNING, "PLUGIN_EXTERNAL_ONLY", "插件依赖缺少仓库来源，安装时需要本地已存在: " + dependency.assetId()));
            }
        }
        checks.add(new CapabilityPackageCheck(CHECK_SEVERITY_INFO, "ASSET_SUMMARY",
                "包含 " + draft.bundle().scripts().size() + " 个脚本 / " + draft.bundle().agents().size() + " 个 Agent / "
                        + draft.bundle().toolsets().size() + " 个工具集 / " + draft.bundle().models().size() + " 个模型"));
        return checks;
    }

    private static CapabilityPackageDiffSummary computeEntryChanges(CapabilityPackageDraft draft,
                                                                     CapabilityPackageDetail currentPackage) {
        List<String> currentEntryKeys = currentPackage == null
                ? List.of()
                : currentPackage.releaseFile().entries().stream().map(item -> item.type() + ":" + item.id()).toList();
        List<String> nextEntryKeys = draft.entries().stream().map(item -> item.type() + ":" + item.id()).toList();
        List<String> addedEntries = nextEntryKeys.stream().filter(item -> !currentEntryKeys.contains(item)).toList();
        List<String> removedEntries = currentEntryKeys.stream().filter(item -> !nextEntryKeys.contains(item)).toList();
        List<String> changedAssets = new ArrayList<>();
        collectChangedAsset(changedAssets, "scripts", currentPackage,
                currentPackage == null ? null : currentPackage.releaseFile().scripts().stream().map(AiPackageScriptFile::id).toList(),
                draft.bundle().scripts().keySet().stream().toList());
        collectChangedAsset(changedAssets, "agents", currentPackage,
                currentPackage == null ? null : currentPackage.releaseFile().agents().stream().map(AiPackageAgentFile::id).toList(),
                draft.bundle().agents().keySet().stream().toList());
        collectChangedAsset(changedAssets, "toolsets", currentPackage,
                currentPackage == null ? null : currentPackage.releaseFile().toolsets().stream().map(AiPackageToolsetFile::id).toList(),
                draft.bundle().toolsets().keySet().stream().toList());
        collectChangedAsset(changedAssets, "models", currentPackage,
                currentPackage == null ? null : currentPackage.releaseFile().models().stream().map(AiPackageModelFile::id).toList(),
                draft.bundle().models().keySet().stream().toList());
        return new CapabilityPackageDiffSummary(
                currentPackage == null ? "INITIAL" : "COMPARE",
                addedEntries,
                removedEntries,
                changedAssets
        );
    }

    private static void collectChangedAsset(List<String> changedAssets, String label,
                                             CapabilityPackageDetail currentPackage,
                                             List<String> currentIds, List<String> nextIds) {
        List<String> sortedCurrent = currentIds == null ? List.of() : currentIds.stream().sorted().toList();
        List<String> sortedNext = nextIds.stream().sorted().toList();
        if (currentPackage == null || !Objects.equals(sortedCurrent, sortedNext)) {
            changedAssets.add(label);
        }
    }
}
