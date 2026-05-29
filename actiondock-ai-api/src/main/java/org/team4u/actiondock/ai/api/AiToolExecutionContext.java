package org.team4u.actiondock.ai.api;

import java.util.Map;

/**
 * AI 工具执行上下文。
 * <p>
 * 封装工具执行时的运行环境信息，包括当前 Agent 运行标识、步骤标识、
 * 调用者类型、关联的脚本和执行记录，以及调用者身份等上下文数据。
 *
 * @param runId       当前 Agent 运行的唯一标识
 * @param stepId      当前执行步骤标识
 * @param callerType  调用者类型
 * @param scriptId    关联的脚本 ID
 * @param executionId 关联的执行记录 ID
 * @param userId      调用者用户 ID
 * @param metadata    附加元数据
 * @author jay.wu
 */
public record AiToolExecutionContext(
        String runId,
        String stepId,
        AiCallerType callerType,
        String scriptId,
        String executionId,
        String userId,
        Map<String, Object> metadata
) {
}
