package org.team4u.actiondock.repository;

import org.team4u.actiondock.ai.api.AiCapability;
import org.team4u.actiondock.ai.tool.ActionDockDynamicAiToolProvider;
import org.team4u.actiondock.domain.model.AiDependency;
import org.team4u.actiondock.shared.NormalizeUtils;


import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AI 能力包 ID 重写工具。
 *
 * <p>在安装能力包时，需要将内部的模型、工具集、Agent、脚本等 ID
 * 替换为运行时 ID。此类提供纯函数方法完成这些重写操作。</p>
 *
 * @author jay.wu
 */
final class AiPackageIdRewriter {

    private static final Pattern SCRIPT_INVOKE_PATTERN = Pattern.compile(
            "scripts\\s*\\.\\s*invoke\\s*\\(\\s*([\"'`])([^\"'`]+)\\1");
    private static final Pattern MODEL_PROFILE_LITERAL_PATTERN = Pattern.compile(
            "(modelProfileId\\s*=\\s*)([\"'`])([^\"'`]+)\\2");
    private static final Pattern AGENT_PROFILE_LITERAL_PATTERN = Pattern.compile(
            "(agentProfileId\\s*=\\s*)([\"'`])([^\"'`]+)\\2");

    private AiPackageIdRewriter() {
    }

    static String rewriteToolName(String toolName,
                                  Map<String, String> agentIdMappings,
                                  Map<String, String> scriptIdMappings) {
        if (NormalizeUtils.isBlank(toolName)) {
            return toolName;
        }
        if (toolName.startsWith(ActionDockDynamicAiToolProvider.SCRIPT_TOOL_PREFIX)) {
            String localId = toolName.substring(ActionDockDynamicAiToolProvider.SCRIPT_TOOL_PREFIX.length());
            return ActionDockDynamicAiToolProvider.SCRIPT_TOOL_PREFIX + scriptIdMappings.getOrDefault(localId, localId);
        }
        if (toolName.startsWith(ActionDockDynamicAiToolProvider.AGENT_TOOL_PREFIX)) {
            String localId = toolName.substring(ActionDockDynamicAiToolProvider.AGENT_TOOL_PREFIX.length());
            return ActionDockDynamicAiToolProvider.AGENT_TOOL_PREFIX + agentIdMappings.getOrDefault(localId, localId);
        }
        return toolName;
    }

    static Map<String, Map<String, Object>> rewriteToolOptions(Map<String, Map<String, Object>> toolOptions,
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

    static String rewriteScriptSource(String source,
                                      Map<String, String> scriptIdMappings,
                                      Map<String, String> modelIdMappings,
                                      Map<String, String> agentIdMappings) {
        if (NormalizeUtils.isBlank(source)) {
            return source;
        }
        String rewritten = replaceScriptInvokeIds(source, scriptIdMappings);
        rewritten = replaceProfileIds(rewritten, MODEL_PROFILE_LITERAL_PATTERN, modelIdMappings);
        return replaceProfileIds(rewritten, AGENT_PROFILE_LITERAL_PATTERN, agentIdMappings);
    }

    static List<AiDependency> rewriteAiDependencies(List<AiDependency> dependencies,
                                                     Map<String, String> modelIdMappings,
                                                     Map<String, String> agentIdMappings) {
        List<AiDependency> rewritten = new ArrayList<>();
        for (AiDependency dependency : NormalizeUtils.nullSafeList(dependencies)) {
            rewritten.add(new AiDependency()
                    .setCapability(dependency.getCapability())
                    .setProfile(modelIdMappings.getOrDefault(dependency.getProfile(), dependency.getProfile()))
                    .setAgentProfile(agentIdMappings.getOrDefault(dependency.getAgentProfile(), dependency.getAgentProfile()))
                    .setRequired(dependency.isRequired()));
        }
        return rewritten;
    }

    static LinkedHashSet<AiCapability> readCapabilities(List<String> capabilities) {
        LinkedHashSet<AiCapability> values = new LinkedHashSet<>();
        for (String capability : NormalizeUtils.nullSafeList(capabilities)) {
            if (NormalizeUtils.isBlank(capability)) {
                continue;
            }
            values.add(AiCapability.valueOf(capability.trim().toUpperCase(Locale.ROOT)));
        }
        return values;
    }

    static List<String> extractScriptDependenciesFromSource(String source) {
        if (NormalizeUtils.isBlank(source)) {
            return List.of();
        }
        LinkedHashSet<String> dependencies = new LinkedHashSet<>();
        Matcher matcher = SCRIPT_INVOKE_PATTERN.matcher(source);
        while (matcher.find()) {
            String scriptId = NormalizeUtils.normalizeNullable(matcher.group(2));
            if (scriptId != null) {
                dependencies.add(scriptId);
            }
        }
        return List.copyOf(dependencies);
    }

    static int countLiteralScriptInvocations(String source) {
        if (NormalizeUtils.isBlank(source)) {
            return 0;
        }
        int count = 0;
        Matcher matcher = SCRIPT_INVOKE_PATTERN.matcher(source);
        while (matcher.find()) {
            count += 1;
        }
        return count;
    }

    static String replaceScriptInvokeIds(String source, Map<String, String> scriptIdMappings) {
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

    static String replaceProfileIds(String source, Pattern pattern, Map<String, String> mappings) {
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
}
