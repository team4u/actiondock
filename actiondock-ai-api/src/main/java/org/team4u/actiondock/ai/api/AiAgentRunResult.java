package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Map;

/**
 * AI Agent 运行结果。
 * <p>
 * 封装一次 Agent 运行的完整输出，包括运行状态、输出数据、执行步骤、
 * Token 用量以及错误信息。
 *
 * @author jay.wu
 */
public record AiAgentRunResult(
        /** 运行记录唯一标识 */
        String runId,
        /** 运行状态 */
        AiRunStatus status,
        /** 输出数据 */
        Map<String, Object> data,
        /** 执行步骤列表 */
        List<AiAgentStep> steps,
        /** Token 用量统计 */
        AiUsage usage,
        /** 错误信息，运行失败时填充 */
        String errorMessage
) {
}
