package org.team4u.actiondock.ai.workbench;

import java.util.Map;

public record AiWorkbenchCommand(
        String objective,
        String instructions,
        String agentProfile,
        String scriptId,
        String executionId,
        Map<String, Object> context
) {
}
