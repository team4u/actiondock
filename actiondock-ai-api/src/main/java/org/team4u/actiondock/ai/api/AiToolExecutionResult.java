package org.team4u.actiondock.ai.api;

import java.util.Map;

public record AiToolExecutionResult(
        boolean success,
        Map<String, Object> output,
        String errorMessage,
        Long latencyMs
) {
    public static AiToolExecutionResult success(Map<String, Object> output, long latencyMs) {
        return new AiToolExecutionResult(true, output == null ? Map.of() : output, null, latencyMs);
    }

    public static AiToolExecutionResult failed(String errorMessage, long latencyMs) {
        return new AiToolExecutionResult(false, Map.of(), errorMessage, latencyMs);
    }
}
