package org.team4u.actiondock.ai.api;

import java.util.Map;

public interface AiTool {
    String name();

    String description();

    default AiToolSourceType sourceType() {
        return AiToolSourceType.SYSTEM;
    }

    default String sourceId() {
        return name();
    }

    default String displayName() {
        return name();
    }

    Map<String, Object> inputSchema();

    Map<String, Object> outputSchema();

    AiToolPermission permission();

    AiToolExecutionResult invoke(Map<String, Object> input, AiToolExecutionContext context);
}
