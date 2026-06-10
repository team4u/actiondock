package org.team4u.actiondock.ai.api;

/**
 * AI Agent 执行步骤类型枚举。
 * <p>
 * 定义 Agent 运行过程中每个步骤的类型，用于区分模型推理、工具调用、审批等不同阶段。
 *
 * @author jay.wu
 */
public enum AiStepType {
    /** 模型推理步骤 */
    MODEL_REASONING,
    /** 工具调用步骤 */
    TOOL_CALL,
    /** 工具返回结果步骤 */
    TOOL_RESULT,
    /** 人工审批步骤 */
    APPROVAL,
    /** 中断步骤 */
    INTERRUPT
}
