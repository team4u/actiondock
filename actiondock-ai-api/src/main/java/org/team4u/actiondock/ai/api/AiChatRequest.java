package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Map;

public record AiChatRequest(String modelProfile, List<AiMessage> messages, Map<String, Object> options) {
}
