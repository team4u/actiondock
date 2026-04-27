package org.team4u.actiondock.ai.api;

import java.util.Map;

public record AiChatResponse(String text, AiUsage usage, Map<String, Object> raw) {
}
