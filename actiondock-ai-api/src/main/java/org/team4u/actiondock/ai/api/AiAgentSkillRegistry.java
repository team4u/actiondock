package org.team4u.actiondock.ai.api;

@FunctionalInterface
public interface AiAgentSkillRegistry {
    AiAgentSkill requireSkill(String skillId);
}
