package org.team4u.actiondock.ai.api;

public interface AiAgentRunObserver {
    AiAgentRunObserver NOOP = new AiAgentRunObserver() {
    };

    default void onTextDelta(String delta, String accumulatedText) {
    }

    default void onStep(AiAgentStep step) {
    }
}
