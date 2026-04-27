package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Map;

public interface AiToolRegistry {
    List<AiTool> listTools(String toolsetId);

    AiTool getTool(String name);

    AiToolExecutionResult invoke(String toolName, Map<String, Object> input, AiToolExecutionContext context);
}
