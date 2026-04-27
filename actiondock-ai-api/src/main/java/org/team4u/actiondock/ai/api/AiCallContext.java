package org.team4u.actiondock.ai.api;

import java.util.Map;

public record AiCallContext(
        AiCallerType callerType,
        String scriptId,
        String executionId,
        String pluginId,
        String agentRunId,
        String agentStepId,
        String userId,
        Map<String, Object> metadata
) {
    public static AiCallContext adminTest() {
        return new AiCallContext(AiCallerType.ADMIN_TEST, null, null, null, null, null, null, Map.of());
    }
}
