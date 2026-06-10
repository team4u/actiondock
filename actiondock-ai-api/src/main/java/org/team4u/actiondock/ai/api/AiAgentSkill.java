package org.team4u.actiondock.ai.api;

import java.util.Map;

/**
 * AI Agent 技能定义。
 * <p>
 * 描述 Agent 可使用的技能，包括技能标识、展示名称、描述、技能内容及相关资源，
 * 用于 Agent 运行时的技能注入和调用。
 *
 * @author jay.wu
 */
public record AiAgentSkill(
        /** 技能唯一标识 */
        String skillId,
        /** 技能展示名称 */
        String displayName,
        /** 技能描述 */
        String description,
        /** 技能内容（Markdown 格式） */
        String skillContent,
        /** 技能关联的资源（key 为资源名，value 为资源内容） */
        Map<String, String> resources,
        /** 技能来源（如 git 仓库路径等） */
        String source) {
}
