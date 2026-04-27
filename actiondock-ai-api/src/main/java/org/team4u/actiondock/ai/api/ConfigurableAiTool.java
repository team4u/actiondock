package org.team4u.actiondock.ai.api;

import java.util.Map;

public interface ConfigurableAiTool extends AiTool {
    AiTool configure(Map<String, Object> options);

    default String configHelp() {
        return null;
    }

    default Map<String, Object> configExample() {
        return Map.of();
    }
}
