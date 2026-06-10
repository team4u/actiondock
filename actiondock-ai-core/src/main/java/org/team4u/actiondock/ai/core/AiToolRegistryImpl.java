package org.team4u.actiondock.ai.core;

import org.team4u.actiondock.ai.api.AiTool;
import org.team4u.actiondock.ai.api.AiToolExecutionContext;
import org.team4u.actiondock.ai.api.AiToolExecutionResult;
import org.team4u.actiondock.ai.api.AiToolPermission;
import org.team4u.actiondock.ai.api.AiToolProvider;
import org.team4u.actiondock.ai.api.AiToolRegistry;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.ai.api.ConfigurableAiTool;
import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.SchemaValueCopier;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * AI 工具注册表实现，管理静态工具和动态工具提供者的注册、查找与调用。
 * <p>
 * 实现 {@link AiToolRegistry} 接口，支持通过工具集（Toolset）或 Agent 配置解析可用工具列表，
 * 处理同一工具在不同来源（工具集/直接引用）之间的冲突检测，并在调用时执行权限校验。
 * 工具提供者通过 {@link AiToolProvider} 接口动态扩展。
 *
 * @author jay.wu
 */
public class AiToolRegistryImpl implements AiToolRegistry {
    private final AiToolsetRepository toolsetRepository;
    private final Map<String, AiTool> tools;
    private final List<AiToolProvider> providers;

    public AiToolRegistryImpl(AiToolsetRepository toolsetRepository, List<AiTool> tools) {
        this(toolsetRepository, tools, List.of());
    }

    public AiToolRegistryImpl(AiToolsetRepository toolsetRepository, List<AiTool> tools, List<AiToolProvider> providers) {
        this.toolsetRepository = toolsetRepository;
        this.tools = new LinkedHashMap<>();
        if (tools != null) {
            tools.forEach(tool -> this.tools.put(tool.name(), tool));
        }
        this.providers = providers == null ? List.of() : List.copyOf(providers);
    }

    @Override
    public List<AiTool> listTools(String toolsetId) {
        if (toolsetId == null || toolsetId.isBlank()) {
            Map<String, AiTool> values = new LinkedHashMap<>(tools);
            for (AiToolProvider provider : providers) {
                for (AiTool tool : provider.listTools()) {
                    values.putIfAbsent(tool.name(), tool);
                }
            }
            return List.copyOf(values.values());
        }
        return toolsetRepository.findById(toolsetId)
                .filter(toolset -> toolset.isEnabled())
                .map(toolset -> toolset.getToolNames().stream()
                        .map(this::getTool)
                        .map(tool -> configureTool(tool, toolset.getToolOptions().get(tool.name())))
                        .peek(tool -> ensureAllowed(tool, toolset.getMaxPermission(), "AI 工具集权限上限"))
                        .toList())
                .orElse(List.of());
    }

    @Override
    public List<AiTool> listAgentTools(AiAgentProfile agentProfile) {
        AgentToolResolution resolution = resolveAgentTools(agentProfile);
        if (!resolution.conflicts().isEmpty()) {
            throw conflictException(resolution.conflicts());
        }
        return resolution.tools().stream().map(ResolvedAgentTool::tool).toList();
    }

    private static AiTool configureTool(AiTool tool, Map<String, Object> options) {
        if (tool instanceof ConfigurableAiTool configurable) {
            return configurable.configure(options == null ? Map.of() : options);
        }
        return tool;
    }

    @Override
    public AiTool getTool(String name) {
        AiTool tool = tools.get(name);
        if (tool == null) {
            tool = providers.stream()
                    .map(provider -> provider.findTool(name))
                    .filter(Optional::isPresent)
                    .map(Optional::get)
                    .findFirst()
                    .orElse(null);
        }
        if (tool == null) {
            throw ActionDockException.notFound(
                    ActionDockErrorCodes.AI_TOOL_NOT_FOUND,
                    "AI 工具不存在: " + name,
                    Map.of("toolName", name)
            );
        }
        return tool;
    }

    @Override
    public AiToolExecutionResult invoke(String toolName, Map<String, Object> input, AiToolExecutionContext context) {
        long started = System.currentTimeMillis();
        try {
            AiTool tool = getTool(toolName);
            AiToolPermission maxPermission = context == null || context.metadata() == null
                    ? AiToolPermission.DANGEROUS_ACTION
                    : AiToolPermission.from(context.metadata().get("maxToolPermission"), AiToolPermission.DANGEROUS_ACTION);
            ensureAllowed(tool, maxPermission, "AI 工具调用权限上限");
            return tool.invoke(input == null ? Map.of() : input, context);
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (Exception exception) {
            return AiToolExecutionResult.failed(exception.getMessage(), System.currentTimeMillis() - started);
        }
    }

    private AgentToolResolution resolveAgentTools(AiAgentProfile agentProfile) {
        if (agentProfile == null) {
            return new AgentToolResolution(List.of(), List.of());
        }
        Map<String, ToolAccumulator> accumulators = new LinkedHashMap<>();
        List<AgentToolConflict> conflicts = new ArrayList<>();
        collectToolsetTools(agentProfile, accumulators, conflicts);
        collectDirectTools(agentProfile, accumulators, conflicts);

        List<ResolvedAgentTool> resolvedTools = new ArrayList<>();
        for (ToolAccumulator accumulator : accumulators.values()) {
            if (accumulator.conflicting) {
                conflicts.add(new AgentToolConflict(accumulator.toolName, List.copyOf(accumulator.sources), "配置不一致"));
                continue;
            }
            resolvedTools.add(new ResolvedAgentTool(
                    accumulator.tool,
                    accumulator.options,
                    List.copyOf(accumulator.sources)
            ));
        }
        return new AgentToolResolution(List.copyOf(resolvedTools), List.copyOf(conflicts));
    }

    private static void ensureAllowed(AiTool tool, AiToolPermission maxPermission, String label) {
        AiToolPermission effectiveMax = maxPermission == null ? AiToolPermission.READ_ONLY : maxPermission;
        AiToolPermission requested = tool == null ? null : tool.permission();
        if (!effectiveMax.allows(requested)) {
            throw new IllegalArgumentException(label + "不允许工具 " + tool.name() + " 使用权限 " + requested);
        }
    }

    private void collectToolsetTools(AiAgentProfile agentProfile,
                                     Map<String, ToolAccumulator> accumulators,
                                     List<AgentToolConflict> conflicts) {
        for (String toolsetId : agentProfile.getToolsetIds()) {
            if (toolsetId == null || toolsetId.isBlank()) {
                throw new IllegalArgumentException("工具集 ID 不能为空");
            }
            AiToolset toolset = toolsetRepository.findById(toolsetId)
                    .orElseThrow(() -> ActionDockException.notFound(
                            ActionDockErrorCodes.AI_TOOLSET_NOT_FOUND,
                            "AI 工具集不存在: " + toolsetId,
                            Map.of("toolsetId", toolsetId)
                    ));
            if (!toolset.isEnabled()) {
                continue;
            }
            for (String toolName : toolset.getToolNames()) {
                if (toolName == null || toolName.isBlank()) {
                    throw new IllegalArgumentException("AI 工具名不能为空");
                }
                Map<String, Object> options = normalizeOptions(toolset.getToolOptions().get(toolName));
                AiTool configuredTool = configureTool(getTool(toolName), options);
                ensureAllowed(configuredTool, toolset.getMaxPermission(), "AI 工具集权限上限");
                addCandidate(accumulators, conflicts, configuredTool, options, new AgentToolSource("toolset", toolsetId, toolName));
            }
        }
    }

    private void collectDirectTools(AiAgentProfile agentProfile,
                                    Map<String, ToolAccumulator> accumulators,
                                    List<AgentToolConflict> conflicts) {
        for (String toolName : new LinkedHashSet<>(agentProfile.getDirectToolNames())) {
            if (toolName == null || toolName.isBlank()) {
                throw new IllegalArgumentException("AI 直接工具名不能为空");
            }
            Map<String, Object> options = normalizeOptions(agentProfile.getDirectToolOptions().get(toolName));
            AiTool configuredTool = configureTool(getTool(toolName), options);
            addCandidate(accumulators, conflicts, configuredTool, options, new AgentToolSource("direct", "direct", toolName));
        }
    }

    private void addCandidate(Map<String, ToolAccumulator> accumulators,
                              List<AgentToolConflict> conflicts,
                              AiTool tool,
                              Map<String, Object> options,
                              AgentToolSource source) {
        ToolAccumulator accumulator = accumulators.get(tool.name());
        if (accumulator == null) {
            accumulators.put(tool.name(), new ToolAccumulator(tool.name(), tool, options, source));
            return;
        }
        accumulator.add(tool, options, source);
        if (accumulator.conflicting) {
            conflicts.removeIf(conflict -> conflict.toolName().equals(tool.name()));
        }
    }

    private static IllegalArgumentException conflictException(List<AgentToolConflict> conflicts) {
        String detail = conflicts.stream()
                .map(conflict -> conflict.toolName() + " 来源 [" + sourceLabels(conflict.sources()) + "] 配置不一致")
                .reduce((left, right) -> left + "; " + right)
                .orElse("存在工具配置冲突");
        return new IllegalArgumentException("Agent 工具配置冲突: " + detail);
    }

    private static String sourceLabels(List<AgentToolSource> sources) {
        return sources.stream().map(AiToolRegistryImpl::sourceLabel).reduce((left, right) -> left + ", " + right).orElse("");
    }

    private static String sourceLabel(AgentToolSource source) {
        if (source == null) {
            return "unknown";
        }
        if ("toolset".equals(source.sourceType())) {
            return "toolset:" + source.sourceId();
        }
        return "direct";
    }

    private static Map<String, Object> normalizeOptions(Map<String, Object> options) {
        return SchemaValueCopier.copyMap(options);
    }

    private record AgentToolResolution(
            List<ResolvedAgentTool> tools,
            List<AgentToolConflict> conflicts
    ) {
    }

    private record ResolvedAgentTool(
            AiTool tool,
            Map<String, Object> options,
            List<AgentToolSource> sources
    ) {
    }

    private record AgentToolConflict(
            String toolName,
            List<AgentToolSource> sources,
            String reason
    ) {
    }

    private record AgentToolSource(
            String sourceType,
            String sourceId,
            String toolName
    ) {
    }

    private static final class ToolAccumulator {
        private final String toolName;
        private AiTool tool;
        private Map<String, Object> options;
        private final List<AgentToolSource> sources = new ArrayList<>();
        private boolean conflicting;

        private ToolAccumulator(String toolName, AiTool tool, Map<String, Object> options, AgentToolSource source) {
            this.toolName = toolName;
            this.tool = tool;
            this.options = options;
            this.sources.add(source);
        }

        private void add(AiTool nextTool, Map<String, Object> nextOptions, AgentToolSource source) {
            sources.add(source);
            if (conflicting) {
                return;
            }
            if (!options.equals(nextOptions)) {
                conflicting = true;
                return;
            }
            this.tool = nextTool;
            this.options = nextOptions;
        }
    }
}
