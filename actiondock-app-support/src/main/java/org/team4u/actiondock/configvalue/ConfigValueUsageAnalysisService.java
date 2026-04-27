package org.team4u.actiondock.configvalue;

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
import org.team4u.actiondock.repository.RepositoryCatalogService;

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
import java.util.Set;
import java.util.function.BiFunction;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 配置值引用分析服务，汇总直接引用、模板声明和受影响脚本。
 */
public class ConfigValueUsageAnalysisService {
    private static final Pattern PLACEHOLDER_PATTERN = Pattern.compile("\\$\\{config\\.([A-Za-z][A-Za-z0-9_.-]*)}");

    private final ConfigValueRepository configValueRepository;
    private final ScriptRepository scriptRepository;
    private final ScriptScheduleRepository scriptScheduleRepository;
    private final PluginRegistryRepository pluginRegistryRepository;
    private final Function<String, Map<String, Object>> loadPluginConfig;
    private final Supplier<List<RepositoryDefinition>> listRepositories;
    private final Function<String, List<RepositoryCatalogService.RepositoryToolDescriptor>> listRepositoryTools;
    private final Supplier<List<RepositoryCatalogService.RepositoryToolDescriptor>> listAllRepositoryTools;
    private final BiFunction<String, String, RepositoryCatalogService.RepositoryToolDetail> getRepositoryTool;

    public ConfigValueUsageAnalysisService(ConfigValueRepository configValueRepository,
                                           ScriptRepository scriptRepository,
                                           ScriptScheduleRepository scriptScheduleRepository,
                                           PluginRegistryRepository pluginRegistryRepository,
                                           Function<String, Map<String, Object>> loadPluginConfig,
                                           Supplier<List<RepositoryDefinition>> listRepositories,
                                           Function<String, List<RepositoryCatalogService.RepositoryToolDescriptor>> listRepositoryTools,
                                           Supplier<List<RepositoryCatalogService.RepositoryToolDescriptor>> listAllRepositoryTools,
                                           BiFunction<String, String, RepositoryCatalogService.RepositoryToolDetail> getRepositoryTool) {
        this.configValueRepository = configValueRepository;
        this.scriptRepository = scriptRepository;
        this.scriptScheduleRepository = scriptScheduleRepository;
        this.pluginRegistryRepository = pluginRegistryRepository;
        this.loadPluginConfig = loadPluginConfig;
        this.listRepositories = listRepositories;
        this.listRepositoryTools = listRepositoryTools;
        this.listAllRepositoryTools = listAllRepositoryTools;
        this.getRepositoryTool = getRepositoryTool;
    }

    public ConfigValueInsight analyze(String key) {
        ConfigValue target = requireConfig(key);
        List<ConfigValue> configValues = configValueRepository.findAll();
        List<ScriptDefinition> scripts = scriptRepository.findAll();
        List<ScriptSchedule> schedules = scriptScheduleRepository.findAll();
        List<PluginRegistration> plugins = pluginRegistryRepository.findAll();
        List<RepositoryCatalogService.RepositoryToolDescriptor> allToolDescriptors = listAllRepositoryTools.get();

        Map<String, Set<String>> configDependencies = new LinkedHashMap<>();
        for (ConfigValue item : configValues) {
            configDependencies.put(item.getKey(), extractPlaceholderKeys(item.getValue()));
        }

        Set<String> cascadingConfigKeys = collectCascadingConfigKeys(key, configDependencies);
        List<ConfigReference> configReferences = configValues.stream()
                .filter(item -> !key.equals(item.getKey()))
                .filter(item -> configDependencies.getOrDefault(item.getKey(), Set.of()).contains(key))
                .map(item -> new ConfigReference(item.getKey(), item.getDescription()))
                .sorted(Comparator.comparing(ConfigReference::key))
                .toList();

        List<ScriptReference> scriptReferences = scripts.stream()
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

        Map<String, ScriptDefinition> scriptsById = new LinkedHashMap<>();
        for (ScriptDefinition script : scripts) {
            scriptsById.put(script.getId(), script);
        }

        List<ScheduleReference> scheduleReferences = schedules.stream()
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

        List<PluginConfigReference> pluginReferences = new ArrayList<>();
        Map<String, Set<String>> pluginCascadeMatches = new LinkedHashMap<>();
        for (PluginRegistration plugin : plugins) {
            Map<String, Object> rawConfig = loadPluginConfig(plugin.getPluginId());
            Set<String> directMatches = filterPlaceholderKeys(rawConfig, Set.of(key));
            if (!directMatches.isEmpty()) {
                pluginReferences.add(new PluginConfigReference(plugin.getPluginId(), plugin.getName(), countDependentScripts(scripts, plugin.getPluginId())));
            }
            Set<String> cascadeMatches = filterPlaceholderKeys(rawConfig, cascadingConfigKeys);
            if (!cascadeMatches.isEmpty()) {
                pluginCascadeMatches.put(plugin.getPluginId(), cascadeMatches);
            }
        }
        pluginReferences = pluginReferences.stream()
                .sorted(Comparator.comparing(PluginConfigReference::pluginId))
                .toList();

        List<TemplateDeclaration> templateDeclarations = scanTemplateDeclarations(key);
        ManagedTemplate managedTemplate = resolveManagedTemplate(target).orElse(null);
        ConfigValueOrigin origin = resolveOrigin(target, managedTemplate, templateDeclarations);

        Map<String, ImpactScriptAccumulator> impacts = new LinkedHashMap<>();
        for (ScriptDefinition script : scripts) {
            Set<String> matchedKeys = filterScriptKeys(script.getSource(), cascadingConfigKeys);
            addScriptImpact(impacts, script, matchedKeys, key, "脚本源码");
        }

        for (ScriptSchedule schedule : schedules) {
            ScriptDefinition script = scriptsById.get(schedule.getScriptId());
            if (script == null) {
                continue;
            }
            Set<String> matchedKeys = filterPlaceholderKeys(schedule.getInput(), cascadingConfigKeys);
            if (matchedKeys.isEmpty()) {
                continue;
            }
            addImpact(impacts, script, buildIndirectReason("定时任务 " + schedule.getName(), matchedKeys, key));
        }

        for (ScriptDefinition script : scripts) {
            for (PluginDependency dependency : script.getPluginDependencies()) {
                Set<String> matchedKeys = pluginCascadeMatches.get(dependency.getPluginId());
                if (matchedKeys == null || matchedKeys.isEmpty()) {
                    continue;
                }
                addImpact(impacts, script, buildIndirectReason("插件配置 " + dependency.getPluginId(), matchedKeys, key));
            }
        }

        Map<String, RepositoryCatalogService.RepositoryToolDescriptor> descriptorsBySource = new LinkedHashMap<>();
        for (RepositoryCatalogService.RepositoryToolDescriptor descriptor : allToolDescriptors) {
            descriptorsBySource.put(descriptor.repositoryId() + ":" + descriptor.toolId(), descriptor);
        }
        for (TemplateDeclaration declaration : templateDeclarations) {
            RepositoryCatalogService.RepositoryToolDescriptor descriptor = descriptorsBySource.get(
                    declaration.repositoryId() + ":" + declaration.toolId()
            );
            if (descriptor == null) {
                continue;
            }
            addImpactForInstalledScript(impacts, scriptsById.get(descriptor.installedScriptId()), "仓库模板声明");
            addImpactForInstalledScript(impacts, scriptsById.get(descriptor.developmentScriptId()), "仓库模板声明");
        }

        List<ImpactScript> impactedScripts = impacts.values().stream()
                .map(ImpactScriptAccumulator::toView)
                .sorted(Comparator.comparing(ImpactScript::scriptId))
                .toList();

        return new ConfigValueInsight(
                target,
                configReferences,
                scriptReferences,
                scheduleReferences,
                pluginReferences,
                templateDeclarations,
                impactedScripts,
                origin,
                new AvailableActions(target.isManaged() && !target.isOverridden(), target.isManaged() && target.isOverridden())
        );
    }

    public ManagedTemplate resolveManagedTemplate(String key) {
        ConfigValue target = requireConfig(key);
        return resolveManagedTemplate(target)
                .orElseThrow(() -> new IllegalArgumentException("来源仓库模板不存在，无法恢复默认值"));
    }

    private java.util.Optional<ManagedTemplate> resolveManagedTemplate(ConfigValue value) {
        if (!value.isManaged() || value.getRepositoryId() == null || value.getRepositoryToolId() == null) {
            return java.util.Optional.empty();
        }
        RepositoryCatalogService.RepositoryToolDetail detail = getRepositoryTool.apply(value.getRepositoryId(), value.getRepositoryToolId());
        RepositoryCatalogService.ConfigTemplateItem template = detail.configTemplate().stream()
                .filter(item -> value.getKey().equals(item.key()))
                .findFirst()
                .orElse(null);
        if (template == null) {
            return java.util.Optional.empty();
        }
        String publishMode = resolvePublishMode(template);
        return java.util.Optional.of(new ManagedTemplate(
                value.getKey(),
                normalizeBlank(detail.descriptor().repositoryId()),
                resolveRepositoryName(detail.descriptor().repositoryId()),
                normalizeBlank(detail.descriptor().toolId()),
                normalizeBlank(detail.descriptor().displayName()),
                normalizeBlank(detail.descriptor().version()),
                normalizeBlank(template.label()),
                template.secret(),
                publishMode,
                publishMode.equals("INLINE") ? normalizeBlank(template.defaultValue()) : ""
        ));
    }

    private ConfigValueOrigin resolveOrigin(ConfigValue value,
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
        for (RepositoryDefinition repository : listRepositories.get()) {
            if (repository == null || !repository.isEnabled()) {
                continue;
            }
            List<RepositoryCatalogService.RepositoryToolDescriptor> tools;
            try {
                tools = listRepositoryTools.apply(repository.getId());
            } catch (RuntimeException ignored) {
                continue;
            }
            for (RepositoryCatalogService.RepositoryToolDescriptor tool : tools) {
                RepositoryCatalogService.RepositoryToolDetail detail;
                try {
                    detail = getRepositoryTool.apply(repository.getId(), tool.toolId());
                } catch (RuntimeException ignored) {
                    continue;
                }
                detail.configTemplate().stream()
                        .filter(item -> key.equals(item.key()))
                        .findFirst()
                        .ifPresent(item -> declarations.add(new TemplateDeclaration(
                                repository.getId(),
                                repository.getName(),
                                tool.toolId(),
                                tool.displayName(),
                                tool.version(),
                                normalizeBlank(item.label()),
                                item.secret(),
                                resolvePublishMode(item),
                                normalizeBlank(item.defaultValue())
                        )));
            }
        }
        return declarations.stream()
                .sorted(Comparator.comparing(TemplateDeclaration::repositoryId).thenComparing(TemplateDeclaration::toolId))
                .toList();
    }

    private Map<String, Object> loadPluginConfig(String pluginId) {
        try {
            Map<String, Object> config = loadPluginConfig.apply(pluginId);
            return config == null ? Map.of() : config;
        } catch (RuntimeException exception) {
            return Map.of();
        }
    }

    private int countDependentScripts(List<ScriptDefinition> scripts, String pluginId) {
        int count = 0;
        for (ScriptDefinition script : scripts) {
            if (script.getPluginDependencies().stream().map(PluginDependency::getPluginId).anyMatch(pluginId::equals)) {
                count += 1;
            }
        }
        return count;
    }

    private void addScriptImpact(Map<String, ImpactScriptAccumulator> impacts,
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

    private void addImpactForInstalledScript(Map<String, ImpactScriptAccumulator> impacts, ScriptDefinition script, String reason) {
        if (script == null) {
            return;
        }
        addImpact(impacts, script, reason);
    }

    private void addImpact(Map<String, ImpactScriptAccumulator> impacts, ScriptDefinition script, String reason) {
        if (script == null) {
            return;
        }
        impacts.computeIfAbsent(script.getId(), key -> new ImpactScriptAccumulator(script))
                .addReason(reason);
    }

    private String buildIndirectReason(String prefix, Set<String> matchedKeys, String targetKey) {
        Set<String> indirectKeys = new LinkedHashSet<>(matchedKeys);
        indirectKeys.remove(targetKey);
        if (indirectKeys.isEmpty()) {
            return prefix + "直接引用";
        }
        return prefix + "通过配置 " + String.join(", ", indirectKeys) + " 间接受影响";
    }

    private Set<String> collectCascadingConfigKeys(String targetKey, Map<String, Set<String>> configDependencies) {
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

    private Set<String> filterScriptKeys(String source, Collection<String> keys) {
        Set<String> matches = new LinkedHashSet<>();
        for (String key : keys) {
            if (scriptUsesKey(source, key)) {
                matches.add(key);
            }
        }
        return matches;
    }

    private boolean scriptUsesKey(String source, String key) {
        if (source == null || source.isBlank()) {
            return false;
        }
        return source.contains("${config." + key + "}")
                || source.contains("config[\"" + key + "\"]")
                || source.contains("config['" + key + "']")
                || source.contains("config.get(\"" + key + "\")")
                || source.contains("config.get('" + key + "')");
    }

    private Set<String> filterPlaceholderKeys(Object value, Collection<String> keys) {
        Set<String> found = new LinkedHashSet<>();
        collectPlaceholderKeys(value, found);
        found.retainAll(new LinkedHashSet<>(keys));
        return found;
    }

    private boolean containsPlaceholderKey(Object value, String key) {
        return filterPlaceholderKeys(value, Set.of(key)).contains(key);
    }

    private void collectPlaceholderKeys(Object value, Set<String> found) {
        if (value instanceof Map<?, ?> map) {
            for (Object item : map.values()) {
                collectPlaceholderKeys(item, found);
            }
            return;
        }
        if (value instanceof Iterable<?> iterable) {
            for (Object item : iterable) {
                collectPlaceholderKeys(item, found);
            }
            return;
        }
        if (!(value instanceof String text) || text.isBlank()) {
            return;
        }
        found.addAll(extractPlaceholderKeys(text));
    }

    private Set<String> extractPlaceholderKeys(String value) {
        if (value == null || value.isBlank()) {
            return Set.of();
        }
        Set<String> keys = new LinkedHashSet<>();
        Matcher matcher = PLACEHOLDER_PATTERN.matcher(value);
        while (matcher.find()) {
            keys.add(matcher.group(1));
        }
        return keys;
    }

    private String resolvePublishMode(RepositoryCatalogService.ConfigTemplateItem template) {
        return (template.secret() || template.defaultValue() == null || template.defaultValue().isBlank())
                ? "PLACEHOLDER"
                : "INLINE";
    }

    private ConfigValue requireConfig(String key) {
        return configValueRepository.findByKey(key)
                .orElseThrow(() -> new IllegalArgumentException("配置值不存在: " + key));
    }

    private String normalizeBlank(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private String resolveRepositoryName(String repositoryId) {
        if (repositoryId == null || repositoryId.isBlank()) {
            return null;
        }
        return listRepositories.get().stream()
                .filter(repository -> repositoryId.equals(repository.getId()))
                .map(RepositoryDefinition::getName)
                .filter(Objects::nonNull)
                .findFirst()
                .orElse(null);
    }

    private String normalizeScope(String scope) {
        return scope == null ? null : scope.toUpperCase(Locale.ROOT);
    }

    public record ConfigValueInsight(
            ConfigValue configValue,
            List<ConfigReference> configReferences,
            List<ScriptReference> scriptReferences,
            List<ScheduleReference> scheduleReferences,
            List<PluginConfigReference> pluginConfigReferences,
            List<TemplateDeclaration> templateDeclarations,
            List<ImpactScript> impactedScripts,
            ConfigValueOrigin origin,
            AvailableActions availableActions
    ) {
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
