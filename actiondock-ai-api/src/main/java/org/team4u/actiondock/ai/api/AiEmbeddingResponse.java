package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Map;

public record AiEmbeddingResponse(List<List<Double>> data, AiUsage usage, Map<String, Object> raw) {
}
