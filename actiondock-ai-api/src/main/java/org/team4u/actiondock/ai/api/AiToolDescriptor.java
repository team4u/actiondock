package org.team4u.actiondock.ai.api;

import java.util.LinkedHashMap;
import java.util.Map;

public record AiToolDescriptor(
        String name,
        String displayName,
        AiToolSourceType sourceType,
        String sourceId,
        String description,
        Map<String, Object> inputSchema,
        Map<String, Object> outputSchema,
        AiToolPermission permission,
        boolean configurable,
        String configHelp,
        Map<String, Object> configExample
) {
    public static AiToolDescriptor from(AiTool tool) {
        if (tool == null) {
            throw new IllegalArgumentException("tool 不能为空");
        }
        boolean configurable = tool instanceof ConfigurableAiTool;
        ConfigurableAiTool configurableTool = configurable ? (ConfigurableAiTool) tool : null;
        return new AiToolDescriptor(
                tool.name(),
                tool.displayName(),
                tool.sourceType(),
                tool.sourceId(),
                tool.description(),
                copy(tool.inputSchema()),
                copy(tool.outputSchema()),
                tool.permission(),
                configurable,
                configurableTool == null ? null : configurableTool.configHelp(),
                configurableTool == null ? null : copy(configurableTool.configExample())
        );
    }

    private static Map<String, Object> copy(Map<String, Object> source) {
        if (source == null || source.isEmpty()) {
            return Map.of();
        }
        return new LinkedHashMap<>(source);
    }
}
