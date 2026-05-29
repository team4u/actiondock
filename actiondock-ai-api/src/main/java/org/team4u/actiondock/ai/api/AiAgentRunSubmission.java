package org.team4u.actiondock.ai.api;

import java.time.LocalDateTime;

/**
 * AI Agent 运行提交凭证。
 * <p>
 * 提交一次 Agent 运行后返回的轻量级凭证，包含运行 ID、当前状态、
 * 使用的 Agent 配置标识以及启动时间。
 *
 * @author jay.wu
 */
public record AiAgentRunSubmission(
        /** 运行记录唯一标识 */
        String runId,
        /** 运行状态 */
        AiRunStatus status,
        /** Agent 配置标识 */
        String agentProfile,
        /** 启动时间 */
        LocalDateTime startedAt
) {
}
