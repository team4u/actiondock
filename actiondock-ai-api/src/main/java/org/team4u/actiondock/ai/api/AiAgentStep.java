package org.team4u.actiondock.ai.api;

import java.time.LocalDateTime;
import java.util.Map;

public record AiAgentStep(
        String id,
        String runId,
        Integer stepIndex,
        AiStepType stepType,
        String modelProfile,
        String toolName,
        AiToolPermission toolPermission,
        Map<String, Object> toolInput,
        Map<String, Object> toolOutput,
        String status,
        Long latencyMs,
        String errorMessage,
        LocalDateTime createdAt
) {
}
