package org.team4u.actiondock.ai.api;

import java.util.Map;

public record AiAgentRunContext(
        AiCallerType callerType,
        String scriptId,
        String executionId,
        String userId,
        Map<String, Object> metadata
) {
    public static final String DISABLE_OUTER_TIMEOUT_METADATA_KEY = "disableOuterTimeout";

    public static AiAgentRunContext adminTest() {
        return new AiAgentRunContext(AiCallerType.ADMIN_TEST, null, null, null, Map.of());
    }
}
