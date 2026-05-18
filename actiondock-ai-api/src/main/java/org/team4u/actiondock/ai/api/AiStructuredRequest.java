package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Map;

public record AiStructuredRequest(
        String modelProfile,
        List<AiMessage> messages,
        Map<String, Object> outputSchema,
        Map<String, Object> options
) {
}
