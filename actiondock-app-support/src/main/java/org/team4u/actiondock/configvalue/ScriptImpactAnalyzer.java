package org.team4u.actiondock.configvalue;

import org.team4u.actiondock.shared.NormalizeUtils;

import org.team4u.actiondock.configvalue.ConfigValueUsageAnalysisService.ImpactScript;
import org.team4u.actiondock.configvalue.ConfigValueUsageAnalysisService.TemplateDeclaration;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptSchedule;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.RepositoryScriptDescriptor;

/**
 * 配置值变更影响分析器，计算受影响的脚本列表。
 *
 * <p>基于脚本源码引用、定时任务输入、插件配置级联、仓库模板声明
 * 四个维度构建影响图，返回受影响脚本的聚合视图。</p>
 */
final class ScriptImpactAnalyzer {

    private ScriptImpactAnalyzer() {
    }

    static List<ImpactScript> buildImpactMap(String key,
                                             Set<String> cascadingConfigKeys,
                                             List<ScriptDefinition> scripts,
                                             List<ScriptSchedule> schedules,
                                             Map<String, Set<String>> pluginCascadeMatches,
                                             List<TemplateDeclaration> templateDeclarations,
                                             Map<String, ScriptDefinition> scriptsById,
                                             List<RepositoryScriptDescriptor> allScriptDescriptors) {
        Map<String, ImpactScriptAccumulator> impacts = new LinkedHashMap<>();
        collectScriptSourceImpacts(impacts, scripts, cascadingConfigKeys, key);
        collectScheduleImpacts(impacts, schedules, scriptsById, cascadingConfigKeys, key);
        collectPluginCascadeImpacts(impacts, scripts, pluginCascadeMatches, key);
        collectTemplateDeclarationImpacts(impacts, templateDeclarations, scriptsById, allScriptDescriptors);
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
                                                          List<RepositoryScriptDescriptor> allScriptDescriptors) {
        Map<String, RepositoryScriptDescriptor> descriptorsBySource = new LinkedHashMap<>();
        for (RepositoryScriptDescriptor descriptor : allScriptDescriptors) {
            descriptorsBySource.put(descriptor.repositoryId() + ":" + descriptor.scriptId(), descriptor);
        }
        for (TemplateDeclaration declaration : templateDeclarations) {
            RepositoryScriptDescriptor descriptor = descriptorsBySource.get(
                    declaration.repositoryId() + ":" + declaration.repositoryScriptId()
            );
            if (descriptor == null) {
                continue;
            }
            if (descriptor.localState() != null) {
                addImpact(impacts, scriptsById.get(descriptor.localState().localAssetId()), "仓库模板声明");
            }
        }
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

    private static Set<String> filterScriptKeys(String source, Collection<String> keys) {
        Set<String> matches = new LinkedHashSet<>();
        for (String key : keys) {
            if (scriptUsesKey(source, key)) {
                matches.add(key);
            }
        }
        return matches;
    }

    static boolean scriptUsesKey(String source, String key) {
        if (NormalizeUtils.isBlank(source)) {
            return false;
        }
        return source.contains("${config." + key + "}")
                || source.contains("config[\"" + key + "\"]")
                || source.contains("config['" + key + "']")
                || source.contains("config.get(\"" + key + "\")")
                || source.contains("config.get('" + key + "')");
    }

    static final class ImpactScriptAccumulator {
        private final ScriptDefinition script;
        private final Set<String> reasons = new LinkedHashSet<>();

        ImpactScriptAccumulator(ScriptDefinition script) {
            this.script = script;
        }

        ImpactScriptAccumulator addReason(String reason) {
            if (NormalizeUtils.isNotBlank(reason)) {
                reasons.add(reason);
            }
            return this;
        }

        ImpactScript toView() {
            return new ImpactScript(
                    script.getId(),
                    script.getName(),
                    script.getScope() == null ? null : script.getScope().name(),
                    script.getRepositoryId(),
                    script.getRepositoryScriptId(),
                    script.getRepositoryVersion(),
                    new ArrayList<>(reasons)
            );
        }
    }
}
