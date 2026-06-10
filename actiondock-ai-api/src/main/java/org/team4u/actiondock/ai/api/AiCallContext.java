package org.team4u.actiondock.ai.api;

import java.util.Map;

/**
 * AI 调用上下文。
 * <p>
 * 封装一次 AI 模型调用的上下文信息，包括调用来源、关联标识及扩展元数据，
 * 用于在调用链路中传递身份和追踪信息。
 *
 * @param callerType  调用来源类型
 * @param scriptId    关联的脚本标识
 * @param executionId 关联的执行记录标识
 * @param pluginId    关联的插件标识
 * @param agentRunId  关联的 Agent 运行标识
 * @param agentStepId 关联的 Agent 步骤标识
 * @param userId      调用用户标识
 * @param metadata    扩展元数据
 * @author jay.wu
 */
public record AiCallContext(
        AiCallerType callerType,
        String scriptId,
        String executionId,
        String pluginId,
        String agentRunId,
        String agentStepId,
        String userId,
        Map<String, Object> metadata
) {
    /**
     * 创建一个管理员测试用的调用上下文实例。
     *
     * @return 所有字段为空的测试上下文
     */
    public static AiCallContext adminTest() {
        return new AiCallContext(AiCallerType.ADMIN_TEST, null, null, null, null, null, null, Map.of());
    }
}
