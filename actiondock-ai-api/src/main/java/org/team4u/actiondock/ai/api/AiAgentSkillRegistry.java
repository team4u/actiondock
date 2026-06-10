package org.team4u.actiondock.ai.api;

/**
 * AI Agent 技能注册表接口。
 * <p>
 * 根据技能标识获取对应的 Agent 技能定义，用于在 Agent 运行时动态加载技能。
 *
 * @author jay.wu
 */
@FunctionalInterface
public interface AiAgentSkillRegistry {

    /**
     * 根据技能标识获取技能定义，不存在时抛出异常。
     *
     * @param skillId 技能唯一标识
     * @return 对应的 Agent 技能定义
     * @throws IllegalArgumentException 当技能不存在时抛出
     */
    AiAgentSkill requireSkill(String skillId);
}
