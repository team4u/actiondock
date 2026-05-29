package org.team4u.actiondock.ai.api;

import java.util.Map;

/**
 * AI Agent 恢复执行命令。
 * <p>
 * 用于恢复一个被暂停的 Agent 运行，携带用户提供的载荷数据
 * 传递给 Agent 继续执行。
 *
 * @author jay.wu
 */
public record AiAgentResumeCommand(
        /** 恢复执行时的载荷数据 */
        Map<String, Object> payload
) {
}
