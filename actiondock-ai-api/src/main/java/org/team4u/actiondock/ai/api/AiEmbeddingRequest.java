package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Map;

public record AiEmbeddingRequest(String modelProfile, List<String> input, Map<String, Object> options) {
}
