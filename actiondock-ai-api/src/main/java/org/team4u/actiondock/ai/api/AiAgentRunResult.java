package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Map;

public record AiAgentRunResult(
        String runId,
        AiRunStatus status,
        Map<String, Object> data,
        List<AiAgentStep> steps,
        AiUsage usage,
        String errorMessage
) {
}
