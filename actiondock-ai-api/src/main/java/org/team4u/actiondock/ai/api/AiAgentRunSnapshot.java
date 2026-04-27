package org.team4u.actiondock.ai.api;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

public record AiAgentRunSnapshot(
        String id,
        String agentProfile,
        AiRunStatus status,
        AiCallerType callerType,
        String scriptId,
        String executionId,
        String userId,
        Map<String, Object> inputSummary,
        Map<String, Object> outputSummary,
        Integer totalModelCalls,
        Integer totalToolCalls,
        Integer totalTokens,
        LocalDateTime startedAt,
        LocalDateTime finishedAt,
        String errorMessage,
        List<AiAgentStep> steps
) {
}
