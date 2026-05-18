package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Map;

public record AiAgentRunRequest(
        String agentProfile,
        List<AiMessage> messages,
        Map<String, Object> input,
        Map<String, Object> options
) {
}
