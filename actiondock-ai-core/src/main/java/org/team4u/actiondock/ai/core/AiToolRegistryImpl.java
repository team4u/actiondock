package org.team4u.actiondock.ai.core;

import org.team4u.actiondock.ai.api.AiTool;
import org.team4u.actiondock.ai.api.AiToolExecutionContext;
import org.team4u.actiondock.ai.api.AiToolExecutionResult;
import org.team4u.actiondock.ai.api.AiToolPermission;
import org.team4u.actiondock.ai.api.AiToolRegistry;
import org.team4u.actiondock.ai.api.AiToolsetRepository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class AiToolRegistryImpl implements AiToolRegistry {
    private final AiToolsetRepository toolsetRepository;
    private final Map<String, AiTool> tools;

    public AiToolRegistryImpl(AiToolsetRepository toolsetRepository, List<AiTool> tools) {
        this.toolsetRepository = toolsetRepository;
        this.tools = new LinkedHashMap<>();
        if (tools != null) {
            tools.forEach(tool -> this.tools.put(tool.name(), tool));
        }
    }

    @Override
    public List<AiTool> listTools(String toolsetId) {
        if (toolsetId == null || toolsetId.isBlank()) {
            return List.copyOf(tools.values());
        }
        return toolsetRepository.findById(toolsetId)
                .filter(toolset -> toolset.isEnabled())
                .map(toolset -> toolset.getToolNames().stream()
                        .map(this::getTool)
                        .peek(tool -> ensureAllowed(tool, toolset.getMaxPermission(), "AI 工具集权限上限"))
                        .toList())
                .orElse(List.of());
    }

    @Override
    public AiTool getTool(String name) {
        AiTool tool = tools.get(name);
        if (tool == null) {
            throw new IllegalArgumentException("AI 工具不存在: " + name);
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
        } catch (Exception exception) {
            return AiToolExecutionResult.failed(exception.getMessage(), System.currentTimeMillis() - started);
        }
    }

    public void assertToolsetsAllowed(List<String> toolsetIds, AiToolPermission maxPermission) {
        if (toolsetIds == null || toolsetIds.isEmpty()) {
            return;
        }
        for (String toolsetId : toolsetIds) {
            for (AiTool tool : listTools(toolsetId)) {
                ensureAllowed(tool, maxPermission, "AI Agent 策略权限上限");
            }
        }
    }

    private void ensureAllowed(AiTool tool, AiToolPermission maxPermission, String label) {
        AiToolPermission effectiveMax = maxPermission == null ? AiToolPermission.READ_ONLY : maxPermission;
        AiToolPermission requested = tool == null ? null : tool.permission();
        if (!effectiveMax.allows(requested)) {
            throw new IllegalArgumentException(label + "不允许工具 " + tool.name() + " 使用权限 " + requested);
        }
    }
}
