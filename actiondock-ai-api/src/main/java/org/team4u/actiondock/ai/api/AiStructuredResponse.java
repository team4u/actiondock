package org.team4u.actiondock.ai.api;

import java.util.Map;

public record AiStructuredResponse(Map<String, Object> data, AiUsage usage, Map<String, Object> raw) {
}
