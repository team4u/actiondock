package org.team4u.actiondock.ai.api;

import java.util.Map;

public record AiAgentSkill(String skillId,
                           String displayName,
                           String description,
                           String skillContent,
                           Map<String, String> resources,
                           String source) {
}
