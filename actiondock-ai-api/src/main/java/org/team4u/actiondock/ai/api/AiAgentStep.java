package org.team4u.actiondock.ai.api;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * AI Agent 执行步骤记录。
 * <p>
 * 记录 Agent 运行过程中每一步的详细信息，包括步骤类型、工具调用输入输出、
 * 执行状态、耗时等，用于执行追踪和结果展示。
 *
 * @author jay.wu
 */
public record AiAgentStep(
        /** 步骤唯一标识 */
        String id,
        /** 所属 Agent 运行唯一标识 */
        String runId,
        /** 步骤序号（从 0 开始） */
        Integer stepIndex,
        /** 步骤类型 */
        AiStepType stepType,
        /** 使用的模型配置名称 */
        String modelProfile,
        /** 调用的工具名称 */
        String toolName,
        /** 工具调用权限 */
        AiToolPermission toolPermission,
        /** 工具调用输入参数 */
        Map<String, Object> toolInput,
        /** 工具调用输出结果 */
        Map<String, Object> toolOutput,
        /** 步骤执行状态 */
        String status,
        /** 步骤执行耗时（毫秒） */
        Long latencyMs,
        /** 错误信息（执行失败时） */
        String errorMessage,
        /** 步骤创建时间 */
        LocalDateTime createdAt
) {
}
