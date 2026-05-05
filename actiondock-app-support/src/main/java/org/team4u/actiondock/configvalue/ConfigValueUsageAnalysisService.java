package org.team4u.actiondock.configvalue;

import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.skill.SkillFileUtils;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.function.BiFunction;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.stream.Collectors;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

/**
 * 配置值引用分析服务，汇总直接引用、模板声明和受影响脚本。
 */
public class ConfigValueUsageAnalysisService {

    private static final System.Logger log = System.getLogger(ConfigValueUsageAnalysisService.class.getName());

    /**
     * 仓库端口接口分组，封装所有直接依赖的 repository。
     */
    public record Repositories(
            ConfigValueRepository configValue,
            ScriptRepository script,
            ScriptScheduleRepository scriptSchedule,
            PluginRegistryRepository pluginRegistry
    ) {
    }

    /**
     * 应用服务分组，封装所有业务查询函数。
     */
    public record ApplicationServices(
            Function<String, Map<String, Object>> loadPluginConfig,
            Supplier<List<RepositoryDefinition>> listRepositories,
            Function<String, List<RepositoryToolDescriptor>> listRepositoryTools,
            Supplier<List<RepositoryToolDescriptor>> listAllRepositoryTools,
            BiFunction<String, String, RepositoryToolDetail> getRepositoryTool,
            Supplier<List<AiModelProfile>> listModelProfiles
    ) {
    }

    private final Repositories repos;
    private final ApplicationServices services;

    public ConfigValueUsageAnalysisService(Repositories repos,
                                           ApplicationServices services) {
        this.repos = repos;
        this.services = services;
    }

    public ConfigValueInsight analyze(String key) {
        ConfigValue target = requireConfig(key);
        AnalysisContext ctx = loadAnalysisContext();
        Set<String> cascadingConfigKeys = collectCascadingConfigKeys(key, ctx.configDependencies);
        AnalysisReferences refs = collectAnalysisReferences(key, ctx, cascadingConfigKeys);

        ManagedTemplate managedTemplate = resolveManagedTemplate(target).orElse(null);
        ConfigValueOrigin origin = resolveOrigin(target, managedTemplate, refs.templateDeclarations);

        List<ImpactScript> impactedScripts = buildImpactMap(
                key, cascadingConfigKeys, ctx.scripts, ctx.schedules,
                refs.pluginCascadeMatches, refs.templateDeclarations,
                ctx.scriptsById, ctx.allToolDescriptors
        );

        return new ConfigValueInsight(
                target,
                refs.configReferences,
                refs.scriptReferences,
                refs.scheduleReferences,
                refs.pluginReferences,
                refs.templateDeclarations,
                refs.modelReferences,
                impactedScripts,
                origin,
                new AvailableActions(target.isManaged() && !target.isOverridden(), target.isManaged() && target.isOverridden())
        );
    }

    private AnalysisContext loadAnalysisContext() {
        List<ConfigValue> configValues = repos.configValue().findAll();
        List<ScriptDefinition> scripts = repos.script().findAll();
        List<ScriptSchedule> schedules = repos.scriptSchedule().findAll();
        List<PluginRegistration> plugins = repos.pluginRegistry().findAll();
        List<RepositoryToolDescriptor> allToolDescriptors = services.listAllRepositoryTools().get();
        Map<String, Set<String>> configDependencies = buildConfigDependencies(configValues);
        Map<String, ScriptDefinition> scriptsById = buildScriptsById(scripts);
        return new AnalysisContext(configValues, scripts, schedules, plugins,
                allToolDescriptors, configDependencies, scriptsById);
    }

    private AnalysisReferences collectAnalysisReferences(String key,
                                                         AnalysisContext ctx,
                                                         Set<String> cascadingConfigKeys) {
        List<ConfigReference> configReferences = collectConfigReferences(key, ctx.configValues, ctx.configDependencies);
        List<ScriptReference> scriptReferences = collectScriptReferences(key, ctx.scripts);
        List<ScheduleReference> scheduleReferences = collectScheduleReferences(key, ctx.schedules, ctx.scriptsById);
        PluginReferenceResult pluginResult = collectPluginReferences(key, cascadingConfigKeys, ctx.plugins, ctx.scripts);
        List<TemplateDeclaration> templateDeclarations = scanTemplateDeclarations(key);
        List<ModelReference> modelReferences = collectModelReferences(key, cascadingConfigKeys);
        return new AnalysisReferences(configReferences, scriptReferences, scheduleReferences,
                pluginResult.pluginReferences(), templateDeclarations, modelReferences,
                pluginResult.pluginCascadeMatches());
    }

    private record AnalysisContext(
            List<ConfigValue> configValues,
            List<ScriptDefinition> scripts,
            List<ScriptSchedule> schedules,
            List<PluginRegistration> plugins,
            List<RepositoryToolDescriptor> allToolDescriptors,
            Map<String, Set<String>> configDependencies,
            Map<String, ScriptDefinition> scriptsById
    ) {
    }

    private record AnalysisReferences(
            List<ConfigReference> configReferences,
            List<ScriptReference> scriptReferences,
            List<ScheduleReference> scheduleReferences,
            List<PluginConfigReference> pluginReferences,
            List<TemplateDeclaration> templateDeclarations,
            List<ModelReference> modelReferences,
            Map<String, Set<String>> pluginCascadeMatches
    ) {
    }

    private static Map<String, Set<String>> buildConfigDependencies(List<ConfigValue> configValues) {
        return configValues.stream()
                .collect(Collectors.toMap(
                        ConfigValue::getKey,
                        item -> PlaceholderKeyExtractor.extractPlaceholderKeys(item.getValue()),
                        (a, b) -> a,
                        LinkedHashMap::new
                ));
    }

    private static List<ConfigReference> collectConfigReferences(String key,
                                                                  List<ConfigValue> configValues,
                                                                  Map<String, Set<String>> configDependencies) {
        return configValues.stream()
                .filter(item -> !key.equals(item.getKey()))
                .filter(item -> configDependencies.getOrDefault(item.getKey(), Set.of()).contains(key))
                .map(item -> new ConfigReference(item.getKey(), item.getDescription()))
                .sorted(Comparator.comparing(ConfigReference::key))
                .toList();
    }

    private static List<ScriptReference> collectScriptReferences(String key, List<ScriptDefinition> scripts) {
        return scripts.stream()
                .filter(script -> scriptUsesKey(script.getSource(), key))
                .map(script -> new ScriptReference(
                        script.getId(),
                        script.getName(),
                        normalizeScope(script.getScope() == null ? null : script.getScope().name()),
                        script.getRepositoryId(),
                        script.getRepositoryToolId(),
                        script.getRepositoryVersion()
                ))
                .sorted(Comparator.comparing(ScriptReference::scriptId))
                .toList();
    }

    private static Map<String, ScriptDefinition> buildScriptsById(List<ScriptDefinition> scripts) {
        return scripts.stream()
                .collect(Collectors.toMap(ScriptDefinition::getId, Function.identity(), (a, b) -> a, LinkedHashMap::new));
    }

    private static List<ScheduleReference> collectScheduleReferences(String key,
                                                                      List<ScriptSchedule> schedules,
                                                                      Map<String, ScriptDefinition> scriptsById) {
        return schedules.stream()
                .filter(schedule -> containsPlaceholderKey(schedule.getInput(), key))
                .map(schedule -> {
                    ScriptDefinition script = scriptsById.get(schedule.getScriptId());
                    return new ScheduleReference(
                            schedule.getId(),
                            schedule.getName(),
                            schedule.getScriptId(),
                            script == null ? schedule.getScriptId() : script.getName()
                    );
                })
                .sorted(Comparator.comparing(ScheduleReference::scheduleId))
                .toList();
    }

    private PluginReferenceResult collectPluginReferences(String key,
                                                          Set<String> cascadingConfigKeys,
                                                          List<PluginRegistration> plugins,
                                                          List<ScriptDefinition> scripts) {
        List<PluginConfigReference> pluginReferences = new ArrayList<>();
        Map<String, Set<String>> pluginCascadeMatches = new LinkedHashMap<>();
        for (PluginRegistration plugin : plugins) {
            Map<String, Object> rawConfig = services.loadPluginConfig().apply(plugin.getPluginId());
            Set<String> directMatches = PlaceholderKeyExtractor.filterPlaceholderKeys(rawConfig, Set.of(key));
            if (!directMatches.isEmpty()) {
                pluginReferences.add(new PluginConfigReference(plugin.getPluginId(), plugin.getName(), countDependentScripts(scripts, plugin.getPluginId())));
            }
            Set<String> cascadeMatches = PlaceholderKeyExtractor.filterPlaceholderKeys(rawConfig, cascadingConfigKeys);
            if (!cascadeMatches.isEmpty()) {
                pluginCascadeMatches.put(plugin.getPluginId(), cascadeMatches);
            }
        }
        return new PluginReferenceResult(
                pluginReferences.stream()
                        .sorted(Comparator.comparing(PluginConfigReference::pluginId))
                        .toList(),
                pluginCascadeMatches
        );
    }

    private List<ModelReference> collectModelReferences(String key, Set<String> cascadingConfigKeys) {
        List<ModelReference> modelReferences = new ArrayList<>();
        for (AiModelProfile model : services.listModelProfiles().get()) {
            if (key.equals(model.getApiKeyConfigKey()) || cascadingConfigKeys.contains(model.getApiKeyConfigKey())) {
                modelReferences.add(toModelReference(model, "apiKeyConfigKey"));
                continue;
            }
            Set<String> optionsMatches = PlaceholderKeyExtractor.filterPlaceholderKeys(model.getDefaultOptions(), cascadingConfigKeys);
            if (!optionsMatches.isEmpty()) {
                modelReferences.add(toModelReference(model, "defaultOptions"));
            }
        }
        return modelReferences.stream()
                .sorted(Comparator.comparing(ModelReference::modelId))
                .toList();
    }

    private static ModelReference toModelReference(AiModelProfile model, String referenceType) {
        return new ModelReference(
                model.getId(),
                model.getName(),
                model.getModelProvider() == null ? null : model.getModelProvider().name(),
                referenceType
        );
    }

    private static List<ImpactScript> buildImpactMap(String key,
                                                     Set<String> cascadingConfigKeys,
                                                     List<ScriptDefinition> scripts,
                                                     List<ScriptSchedule> schedules,
                                                     Map<String, Set<String>> pluginCascadeMatches,
                                                     List<TemplateDeclaration> templateDeclarations,
                                                     Map<String, ScriptDefinition> scriptsById,
                                                     List<RepositoryToolDescriptor> allToolDescriptors) {
        Map<String, ImpactScriptAccumulator> impacts = new LinkedHashMap<>();
        collectScriptSourceImpacts(impacts, scripts, cascadingConfigKeys, key);
        collectScheduleImpacts(impacts, schedules, scriptsById, cascadingConfigKeys, key);
        collectPluginCascadeImpacts(impacts, scripts, pluginCascadeMatches, key);
        collectTemplateDeclarationImpacts(impacts, templateDeclarations, scriptsById, allToolDescriptors);
        return impacts.values().stream()
                .map(ImpactScriptAccumulator::toView)
                .sorted(Comparator.comparing(ImpactScript::scriptId))
                .toList();
    }

    private static void collectScriptSourceImpacts(Map<String, ImpactScriptAccumulator> impacts,
                                                   List<ScriptDefinition> scripts,
                                                   Set<String> cascadingConfigKeys,
                                                   String key) {
        for (ScriptDefinition script : scripts) {
            Set<String> matchedKeys = filterScriptKeys(script.getSource(), cascadingConfigKeys);
            addScriptImpact(impacts, script, matchedKeys, key, "脚本源码");
        }
    }

    private static void collectScheduleImpacts(Map<String, ImpactScriptAccumulator> impacts,
                                               List<ScriptSchedule> schedules,
                                               Map<String, ScriptDefinition> scriptsById,
                                               Set<String> cascadingConfigKeys,
                                               String key) {
        for (ScriptSchedule schedule : schedules) {
            ScriptDefinition script = scriptsById.get(schedule.getScriptId());
            if (script == null) {
                continue;
            }
            Set<String> matchedKeys = PlaceholderKeyExtractor.filterPlaceholderKeys(schedule.getInput(), cascadingConfigKeys);
            if (matchedKeys.isEmpty()) {
                continue;
            }
            addImpact(impacts, script, buildIndirectReason("定时任务 " + schedule.getName(), matchedKeys, key));
        }
    }

    private static void collectPluginCascadeImpacts(Map<String, ImpactScriptAccumulator> impacts,
                                                    List<ScriptDefinition> scripts,
                                                    Map<String, Set<String>> pluginCascadeMatches,
                                                    String key) {
        for (ScriptDefinition script : scripts) {
            for (PluginDependency dependency : script.getPluginDependencies()) {
                Set<String> matchedKeys = pluginCascadeMatches.get(dependency.getPluginId());
                if (matchedKeys == null || matchedKeys.isEmpty()) {
                    continue;
                }
                addImpact(impacts, script, buildIndirectReason("插件配置 " + dependency.getPluginId(), matchedKeys, key));
            }
        }
    }

    private static void collectTemplateDeclarationImpacts(Map<String, ImpactScriptAccumulator> impacts,
                                                          List<TemplateDeclaration> templateDeclarations,
                                                          Map<String, ScriptDefinition> scriptsById,
                                                          List<RepositoryToolDescriptor> allToolDescriptors) {
        Map<String, RepositoryToolDescriptor> descriptorsBySource = new LinkedHashMap<>();
        for (RepositoryToolDescriptor descriptor : allToolDescriptors) {
            descriptorsBySource.put(descriptor.repositoryId() + ":" + descriptor.toolId(), descriptor);
        }
        for (TemplateDeclaration declaration : templateDeclarations) {
            RepositoryToolDescriptor descriptor = descriptorsBySource.get(
                    declaration.repositoryId() + ":" + declaration.toolId()
            );
            if (descriptor == null) {
                continue;
            }
            addImpact(impacts, scriptsById.get(descriptor.installedScriptId()), "仓库模板声明");
            addImpact(impacts, scriptsById.get(descriptor.developmentScriptId()), "仓库模板声明");
        }
    }

    public ManagedTemplate resolveManagedTemplate(String key) {
        ConfigValue target = requireConfig(key);
        return resolveManagedTemplate(target)
                .orElseThrow(() -> new IllegalArgumentException("来源仓库模板不存在，无法恢复默认值"));
    }

    private Optional<ManagedTemplate> resolveManagedTemplate(ConfigValue value) {
        if (!value.isManaged() || value.getRepositoryId() == null || value.getRepositoryToolId() == null) {
            return Optional.empty();
        }
        RepositoryToolDetail detail = services.getRepositoryTool().apply(value.getRepositoryId(), value.getRepositoryToolId());
        ConfigTemplateItem template = detail.configTemplate().stream()
                .filter(item -> value.getKey().equals(item.key()))
                .findFirst()
                .orElse(null);
        if (template == null) {
            return Optional.empty();
        }
        String publishMode = template.resolvePublishMode();
        return Optional.of(new ManagedTemplate(
                value.getKey(),
                SkillFileUtils.normalizeNullable(detail.descriptor().repositoryId()),
                resolveRepositoryName(detail.descriptor().repositoryId()),
                SkillFileUtils.normalizeNullable(detail.descriptor().toolId()),
                SkillFileUtils.normalizeNullable(detail.descriptor().displayName()),
                SkillFileUtils.normalizeNullable(detail.descriptor().version()),
                SkillFileUtils.normalizeNullable(template.label()),
                template.secret(),
                publishMode,
                publishMode.equals("INLINE") ? SkillFileUtils.normalizeNullable(template.defaultValue()) : ""
        ));
    }

    private static ConfigValueOrigin resolveOrigin(ConfigValue value,
                                                   ManagedTemplate managedTemplate,
                                                   List<TemplateDeclaration> templateDeclarations) {
        if (value.getRepositoryId() == null && value.getRepositoryToolId() == null && value.getRepositoryVersion() == null) {
            return null;
        }
        if (managedTemplate != null) {
            return new ConfigValueOrigin(
                    managedTemplate.repositoryId(),
                    managedTemplate.repositoryName(),
                    managedTemplate.toolId(),
                    managedTemplate.toolName(),
                    managedTemplate.version()
            );
        }
        TemplateDeclaration fallback = templateDeclarations.stream()
                .filter(item -> Objects.equals(item.repositoryId(), value.getRepositoryId()))
                .filter(item -> Objects.equals(item.toolId(), value.getRepositoryToolId()))
                .findFirst()
                .orElse(null);
        return new ConfigValueOrigin(
                value.getRepositoryId(),
                fallback == null ? null : fallback.repositoryName(),
                value.getRepositoryToolId(),
                fallback == null ? null : fallback.toolName(),
                value.getRepositoryVersion()
        );
    }

    private List<TemplateDeclaration> scanTemplateDeclarations(String key) {
        List<TemplateDeclaration> declarations = new ArrayList<>();
        for (RepositoryDefinition repository : services.listRepositories().get()) {
            if (repository == null || !repository.isEnabled()) {
                continue;
            }
            declarations.addAll(collectDeclarationsFromRepository(repository, key));
        }
        return declarations.stream()
                .sorted(Comparator.comparing(TemplateDeclaration::repositoryId).thenComparing(TemplateDeclaration::toolId))
                .toList();
    }

    private List<TemplateDeclaration> collectDeclarationsFromRepository(RepositoryDefinition repository, String key) {
        List<TemplateDeclaration> declarations = new ArrayList<>();
        List<RepositoryToolDescriptor> tools;
        try {
            tools = services.listRepositoryTools().apply(repository.getId());
        } catch (RuntimeException exception) {
            log.log(System.Logger.Level.DEBUG, "扫描跳过: {0}", exception.getMessage());
            return declarations;
        }
        for (RepositoryToolDescriptor tool : tools) {
            RepositoryToolDetail detail;
            try {
                detail = services.getRepositoryTool().apply(repository.getId(), tool.toolId());
            } catch (RuntimeException exception) {
                log.log(System.Logger.Level.DEBUG, "扫描跳过: {0}", exception.getMessage());
                continue;
            }
            detail.configTemplate().stream()
                    .filter(item -> key.equals(item.key()))
                    .findFirst()
                    .ifPresent(item -> declarations.add(toTemplateDeclaration(repository, tool, item)));
        }
        return declarations;
    }

    private static TemplateDeclaration toTemplateDeclaration(RepositoryDefinition repository,
                                                              RepositoryToolDescriptor tool,
                                                              ConfigTemplateItem item) {
        return new TemplateDeclaration(
                repository.getId(),
                repository.getName(),
                tool.toolId(),
                tool.displayName(),
                tool.version(),
                SkillFileUtils.normalizeNullable(item.label()),
                item.secret(),
                item.resolvePublishMode(),
                SkillFileUtils.normalizeNullable(item.defaultValue())
        );
    }

    private static int countDependentScripts(List<ScriptDefinition> scripts, String pluginId) {
        int count = 0;
        for (ScriptDefinition script : scripts) {
            if (script.getPluginDependencies().stream().map(PluginDependency::getPluginId).anyMatch(pluginId::equals)) {
                count += 1;
            }
        }
        return count;
    }

    private static void addScriptImpact(Map<String, ImpactScriptAccumulator> impacts,
                                        ScriptDefinition script,
                                        Set<String> matchedKeys,
                                        String targetKey,
                                        String sourceLabel) {
        if (matchedKeys.isEmpty()) {
            return;
        }
        if (matchedKeys.contains(targetKey)) {
            addImpact(impacts, script, sourceLabel + "直接引用");
        }
        Set<String> indirectKeys = new LinkedHashSet<>(matchedKeys);
        indirectKeys.remove(targetKey);
        if (!indirectKeys.isEmpty()) {
            addImpact(impacts, script, buildIndirectReason(sourceLabel, indirectKeys, targetKey));
        }
    }

    private static void addImpact(Map<String, ImpactScriptAccumulator> impacts, ScriptDefinition script, String reason) {
        if (script == null) {
            return;
        }
        impacts.computeIfAbsent(script.getId(), key -> new ImpactScriptAccumulator(script))
                .addReason(reason);
    }

    private static String buildIndirectReason(String prefix, Set<String> matchedKeys, String targetKey) {
        Set<String> indirectKeys = new LinkedHashSet<>(matchedKeys);
        indirectKeys.remove(targetKey);
        if (indirectKeys.isEmpty()) {
            return prefix + "直接引用";
        }
        return prefix + "通过配置 " + String.join(", ", indirectKeys) + " 间接受影响";
    }

    private static Set<String> collectCascadingConfigKeys(String targetKey, Map<String, Set<String>> configDependencies) {
        Set<String> cascading = new LinkedHashSet<>();
        ArrayDeque<String> queue = new ArrayDeque<>();
        cascading.add(targetKey);
        queue.add(targetKey);
        while (!queue.isEmpty()) {
            String current = queue.removeFirst();
            for (Map.Entry<String, Set<String>> entry : configDependencies.entrySet()) {
                if (!entry.getValue().contains(current)) {
                    continue;
                }
                if (cascading.add(entry.getKey())) {
                    queue.add(entry.getKey());
                }
            }
        }
        return cascading;
    }

    private static Set<String> filterScriptKeys(String source, Collection<String> keys) {
        Set<String> matches = new LinkedHashSet<>();
        for (String key : keys) {
            if (scriptUsesKey(source, key)) {
                matches.add(key);
            }
        }
        return matches;
    }

    private static boolean scriptUsesKey(String source, String key) {
        if (source == null || source.isBlank()) {
            return false;
        }
        return source.contains("${config." + key + "}")
                || source.contains("config[\"" + key + "\"]")
                || source.contains("config['" + key + "']")
                || source.contains("config.get(\"" + key + "\")")
                || source.contains("config.get('" + key + "')");
    }

    private static boolean containsPlaceholderKey(Object value, String key) {
        return PlaceholderKeyExtractor.filterPlaceholderKeys(value, Set.of(key)).contains(key);
    }

    private ConfigValue requireConfig(String key) {
        return repos.configValue().findByKey(key)
                .orElseThrow(() -> new IllegalArgumentException("配置值不存在: " + key));
    }

    private String resolveRepositoryName(String repositoryId) {
        if (repositoryId == null || repositoryId.isBlank()) {
            return null;
        }
        return services.listRepositories().get().stream()
                .filter(repository -> repositoryId.equals(repository.getId()))
                .map(RepositoryDefinition::getName)
                .filter(Objects::nonNull)
                .findFirst()
                .orElse(null);
    }

    private static String normalizeScope(String scope) {
        return scope == null ? null : scope.toUpperCase(Locale.ROOT);
    }

    public record ConfigValueInsight(
            ConfigValue configValue,
            List<ConfigReference> configReferences,
            List<ScriptReference> scriptReferences,
            List<ScheduleReference> scheduleReferences,
            List<PluginConfigReference> pluginConfigReferences,
            List<TemplateDeclaration> templateDeclarations,
            List<ModelReference> modelReferences,
            List<ImpactScript> impactedScripts,
            ConfigValueOrigin origin,
            AvailableActions availableActions
    ) {
    }

    public record ModelReference(String modelId, String modelName, String modelProvider, String referenceType) {
    }

    public record ConfigReference(String key, String description) {
    }

    public record ScriptReference(String scriptId,
                                  String scriptName,
                                  String scope,
                                  String repositoryId,
                                  String repositoryToolId,
                                  String repositoryVersion) {
    }

    public record ScheduleReference(String scheduleId, String scheduleName, String scriptId, String scriptName) {
    }

    public record PluginConfigReference(String pluginId, String pluginName, int dependentScriptCount) {
    }

    public record TemplateDeclaration(String repositoryId,
                                      String repositoryName,
                                      String toolId,
                                      String toolName,
                                      String version,
                                      String label,
                                      boolean secret,
                                      String publishMode,
                                      String defaultValue) {
    }

    public record ImpactScript(String scriptId,
                               String scriptName,
                               String scope,
                               String repositoryId,
                               String repositoryToolId,
                               String repositoryVersion,
                               List<String> reasons) {
    }

    public record ConfigValueOrigin(String repositoryId,
                                    String repositoryName,
                                    String toolId,
                                    String toolName,
                                    String version) {
    }

    public record AvailableActions(boolean canCopyAsLocalOverride, boolean canRestoreRepositoryDefault) {
    }

    private record PluginReferenceResult(List<PluginConfigReference> pluginReferences,
                                         Map<String, Set<String>> pluginCascadeMatches) {
    }

    public record ManagedTemplate(String key,
                                  String repositoryId,
                                  String repositoryName,
                                  String toolId,
                                  String toolName,
                                  String version,
                                  String label,
                                  boolean secret,
                                  String publishMode,
                                  String value) {
    }

    private static final class ImpactScriptAccumulator {
        private final ScriptDefinition script;
        private final Set<String> reasons = new LinkedHashSet<>();

        private ImpactScriptAccumulator(ScriptDefinition script) {
            this.script = script;
        }

        private ImpactScriptAccumulator addReason(String reason) {
            if (reason != null && !reason.isBlank()) {
                reasons.add(reason);
            }
            return this;
        }

        private ImpactScript toView() {
            return new ImpactScript(
                    script.getId(),
                    script.getName(),
                    script.getScope() == null ? null : script.getScope().name(),
                    script.getRepositoryId(),
                    script.getRepositoryToolId(),
                    script.getRepositoryVersion(),
                    new ArrayList<>(reasons)
            );
        }
    }
}
