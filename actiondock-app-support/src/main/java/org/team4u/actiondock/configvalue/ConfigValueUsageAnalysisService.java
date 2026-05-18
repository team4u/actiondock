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
import org.team4u.actiondock.shared.NormalizeUtils;

import java.util.ArrayDeque;
import java.util.ArrayList;
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

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.PUBLISH_MODE_INLINE;
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
            Function<String, List<RepositoryScriptDescriptor>> listRepositoryScripts,
            Supplier<List<RepositoryScriptDescriptor>> listAllRepositoryScripts,
            BiFunction<String, String, RepositoryScriptDetail> getRepositoryScript,
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

        ManagedTemplate managedTemplate = resolveManagedTemplate(target, ctx.repositoryNameById()).orElse(null);
        ConfigValueOrigin origin = resolveOrigin(target, managedTemplate, refs.templateDeclarations);

        List<ImpactScript> impactedScripts = ScriptImpactAnalyzer.buildImpactMap(
                key, cascadingConfigKeys, ctx.scripts, ctx.schedules,
                refs.pluginCascadeMatches, refs.templateDeclarations,
                ctx.scriptsById, ctx.allScriptDescriptors
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
        List<RepositoryScriptDescriptor> allScriptDescriptors = services.listAllRepositoryScripts().get();
        Map<String, Set<String>> configDependencies = buildConfigDependencies(configValues);
        Map<String, ScriptDefinition> scriptsById = buildScriptsById(scripts);
        Map<String, String> repositoryNameById = services.listRepositories().get().stream()
                .filter(r -> r.getId() != null && r.getName() != null)
                .collect(Collectors.toMap(RepositoryDefinition::getId, RepositoryDefinition::getName, (a, b) -> a));
        return new AnalysisContext(configValues, scripts, schedules, plugins,
                allScriptDescriptors, configDependencies, scriptsById, repositoryNameById);
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
            List<RepositoryScriptDescriptor> allScriptDescriptors,
            Map<String, Set<String>> configDependencies,
            Map<String, ScriptDefinition> scriptsById,
            Map<String, String> repositoryNameById
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
                .filter(script -> ScriptImpactAnalyzer.scriptUsesKey(script.getSource(), key))
                .map(script -> new ScriptReference(
                        script.getId(),
                        script.getName(),
                        script.getScope() == null ? null : script.getScope().name().toUpperCase(Locale.ROOT),
                        script.getRepositoryId(),
                        script.getRepositoryScriptId(),
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
                pluginReferences.add(new PluginConfigReference(plugin.getPluginId(), plugin.getName(),
                        (int) scripts.stream().filter(s -> s.getPluginDependencies().stream().map(PluginDependency::getPluginId).anyMatch(plugin.getPluginId()::equals)).count()));
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

    public ManagedTemplate resolveManagedTemplate(String key) {
        ConfigValue target = requireConfig(key);
        return resolveManagedTemplate(target, cachedRepositoryNameById())
                .orElseThrow(() -> new IllegalArgumentException("来源仓库模板不存在，无法恢复默认值"));
    }

    private Optional<ManagedTemplate> resolveManagedTemplate(ConfigValue value, Map<String, String> repositoryNameById) {
        if (!value.isManaged() || value.getRepositoryId() == null || value.getRepositoryScriptId() == null) {
            return Optional.empty();
        }
        RepositoryScriptDetail detail = services.getRepositoryScript().apply(value.getRepositoryId(), value.getRepositoryScriptId());
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
                NormalizeUtils.normalizeNullable(detail.descriptor().repositoryId()),
                resolveRepositoryName(detail.descriptor().repositoryId(), repositoryNameById),
                NormalizeUtils.normalizeNullable(detail.descriptor().scriptId()),
                NormalizeUtils.normalizeNullable(detail.descriptor().displayName()),
                NormalizeUtils.normalizeNullable(detail.descriptor().version()),
                NormalizeUtils.normalizeNullable(template.label()),
                template.secret(),
                publishMode,
                publishMode.equals(PUBLISH_MODE_INLINE) ? NormalizeUtils.normalizeNullable(template.defaultValue()) : ""
        ));
    }

    private static ConfigValueOrigin resolveOrigin(ConfigValue value,
                                                   ManagedTemplate managedTemplate,
                                                   List<TemplateDeclaration> templateDeclarations) {
        if (value.getRepositoryId() == null && value.getRepositoryScriptId() == null && value.getRepositoryVersion() == null) {
            return null;
        }
        if (managedTemplate != null) {
            return new ConfigValueOrigin(
                    managedTemplate.repositoryId(),
                    managedTemplate.repositoryName(),
                    managedTemplate.repositoryScriptId(),
                    managedTemplate.scriptName(),
                    managedTemplate.version()
            );
        }
        TemplateDeclaration fallback = templateDeclarations.stream()
                .filter(item -> Objects.equals(item.repositoryId(), value.getRepositoryId())
                        && Objects.equals(item.repositoryScriptId(), value.getRepositoryScriptId()))
                .findFirst()
                .orElse(null);
        return new ConfigValueOrigin(
                value.getRepositoryId(),
                fallback == null ? null : fallback.repositoryName(),
                value.getRepositoryScriptId(),
                fallback == null ? null : fallback.scriptName(),
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
                .sorted(Comparator.comparing(TemplateDeclaration::repositoryId).thenComparing(TemplateDeclaration::repositoryScriptId))
                .toList();
    }

    private List<TemplateDeclaration> collectDeclarationsFromRepository(RepositoryDefinition repository, String key) {
        List<TemplateDeclaration> declarations = new ArrayList<>();
        List<RepositoryScriptDescriptor> scripts;
        try {
            scripts = services.listRepositoryScripts().apply(repository.getId());
        } catch (RuntimeException exception) {
            log.log(System.Logger.Level.DEBUG, "扫描跳过: {0}", exception.getMessage());
            return declarations;
        }
        for (RepositoryScriptDescriptor script : scripts) {
            RepositoryScriptDetail detail;
            try {
                detail = services.getRepositoryScript().apply(repository.getId(), script.scriptId());
            } catch (RuntimeException exception) {
                log.log(System.Logger.Level.DEBUG, "扫描跳过: {0}", exception.getMessage());
                continue;
            }
            detail.configTemplate().stream()
                    .filter(item -> key.equals(item.key()))
                    .findFirst()
                    .ifPresent(item -> declarations.add(toTemplateDeclaration(repository, script, item)));
        }
        return declarations;
    }

    private static TemplateDeclaration toTemplateDeclaration(RepositoryDefinition repository,
                                                              RepositoryScriptDescriptor script,
                                                              ConfigTemplateItem item) {
        return new TemplateDeclaration(
                repository.getId(),
                repository.getName(),
                script.scriptId(),
                script.displayName(),
                script.version(),
                NormalizeUtils.normalizeNullable(item.label()),
                item.secret(),
                item.resolvePublishMode(),
                NormalizeUtils.normalizeNullable(item.defaultValue())
        );
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

    private static boolean containsPlaceholderKey(Object value, String key) {
        return PlaceholderKeyExtractor.containsPlaceholderKey(value, key);
    }

    private ConfigValue requireConfig(String key) {
        return repos.configValue().findByKey(key)
                .orElseThrow(() -> new IllegalArgumentException("配置值不存在: " + key));
    }

    private static String resolveRepositoryName(String repositoryId, Map<String, String> nameById) {
        return nameById.get(repositoryId);
    }

    private Map<String, String> cachedRepositoryNameById() {
        return services.listRepositories().get().stream()
                .filter(r -> r.getId() != null && r.getName() != null)
                .collect(Collectors.toMap(RepositoryDefinition::getId, RepositoryDefinition::getName, (a, b) -> a));
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
                                  String repositoryScriptId,
                                  String repositoryVersion) {
    }

    public record ScheduleReference(String scheduleId, String scheduleName, String scriptId, String scriptName) {
    }

    public record PluginConfigReference(String pluginId, String pluginName, int dependentScriptCount) {
    }

    public record TemplateDeclaration(String repositoryId,
                                      String repositoryName,
                                      String repositoryScriptId,
                                      String scriptName,
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
                               String repositoryScriptId,
                               String repositoryVersion,
                               List<String> reasons) {
    }

    public record ConfigValueOrigin(String repositoryId,
                                    String repositoryName,
                                    String repositoryScriptId,
                                    String scriptName,
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
                                  String repositoryScriptId,
                                  String scriptName,
                                  String version,
                                  String label,
                                  boolean secret,
                                  String publishMode,
                                  String value) {
        public ConfigValue toConfigValue() {
            return new ConfigValue()
                    .setKey(key)
                    .setValue(value)
                    .setDescription(label)
                    .setSecret(secret)
                    .setRepositoryId(repositoryId)
                    .setRepositoryScriptId(repositoryScriptId)
                    .setRepositoryVersion(version)
                    .setPublishMode(publishMode)
                    .setManaged(true)
                    .setOverridden(false);
        }
    }

}
