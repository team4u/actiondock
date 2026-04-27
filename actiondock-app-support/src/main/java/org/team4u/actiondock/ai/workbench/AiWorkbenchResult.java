package org.team4u.actiondock.ai.workbench;

import org.team4u.actiondock.ai.api.AiAgentStep;
import org.team4u.actiondock.ai.api.AiRunStatus;

import java.util.List;
import java.util.Map;

public record AiWorkbenchResult(
        AiWorkbenchTaskType taskType,
        AiRunStatus status,
        Map<String, Object> result,
        String agentRunId,
        List<AiAgentStep> steps,
        Map<String, Object> rawOutput,
        String errorMessage
) {
}
