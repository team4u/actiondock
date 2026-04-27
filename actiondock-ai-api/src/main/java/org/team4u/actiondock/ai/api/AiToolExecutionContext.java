package org.team4u.actiondock.ai.api;

import java.util.Map;

public record AiToolExecutionContext(
        String runId,
        String stepId,
        AiCallerType callerType,
        String scriptId,
        String executionId,
        String userId,
        Map<String, Object> metadata
) {
}
