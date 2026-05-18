package org.team4u.actiondock.ai.api;

import java.time.LocalDateTime;

public record AiAgentRunSubmission(
        String runId,
        AiRunStatus status,
        String agentProfile,
        LocalDateTime startedAt
) {
}
