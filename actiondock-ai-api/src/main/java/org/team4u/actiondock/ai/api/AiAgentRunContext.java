package org.team4u.actiondock.ai.api;

import java.util.Map;

/**
 * AI Agent 运行上下文。
 * <p>
 * 携带运行时的调用来源信息，包括调用方类型、关联脚本与执行记录标识、
 * 用户标识以及自定义元数据。上下文在 Agent 运行全流程中传递，
 * 用于权限校验、审计追踪和行为控制。
 *
 * @author jay.wu
 */
public record AiAgentRunContext(
        /** 调用来源类型 */
        AiCallerType callerType,
        /** 关联的脚本标识 */
        String scriptId,
        /** 关联的执行记录标识 */
        String executionId,
        /** 发起调用的用户标识 */
        String userId,
        /** 自定义元数据 */
        Map<String, Object> metadata
) {
    /** 元数据键：禁用外层超时控制 */
    public static final String DISABLE_OUTER_TIMEOUT_METADATA_KEY = "disableOuterTimeout";

    /**
     * 创建管理后台测试用的运行上下文。
     *
     * @return 调用来源为 ADMIN_TEST、其余字段为空的上下文实例
     */
    public static AiAgentRunContext adminTest() {
        return new AiAgentRunContext(AiCallerType.ADMIN_TEST, null, null, null, Map.of());
    }
}
