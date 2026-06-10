package org.team4u.actiondock.ai.api;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * AI Agent 运行快照。
 * <p>
 * 运行记录的只读视图，包含完整的运行信息，用于 API 响应和查询场景。
 * 涵盖调用来源、关联脚本与执行记录、输入输出摘要、统计指标及执行步骤详情。
 *
 * @author jay.wu
 */
public record AiAgentRunSnapshot(
        /** 运行记录唯一标识 */
        String id,
        /** Agent 配置标识 */
        String agentProfile,
        /** 运行状态 */
        AiRunStatus status,
        /** 调用来源类型 */
        AiCallerType callerType,
        /** 关联的脚本标识 */
        String scriptId,
        /** 关联的执行记录标识 */
        String executionId,
        /** 发起调用的用户标识 */
        String userId,
        /** 输入摘要 */
        Map<String, Object> inputSummary,
        /** 输出摘要 */
        Map<String, Object> outputSummary,
        /** 模型调用总次数 */
        Integer totalModelCalls,
        /** 工具调用总次数 */
        Integer totalToolCalls,
        /** Token 消耗总量 */
        Integer totalTokens,
        /** 启动时间 */
        LocalDateTime startedAt,
        /** 结束时间 */
        LocalDateTime finishedAt,
        /** 错误信息，运行失败时填充 */
        String errorMessage,
        /** 执行步骤列表 */
        List<AiAgentStep> steps
) {
}
