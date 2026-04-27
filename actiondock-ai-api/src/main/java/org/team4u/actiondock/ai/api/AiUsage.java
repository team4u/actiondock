package org.team4u.actiondock.ai.api;

public record AiUsage(Integer inputTokens, Integer outputTokens, Integer totalTokens) {
    public static AiUsage empty() {
        return new AiUsage(0, 0, 0);
    }
}
