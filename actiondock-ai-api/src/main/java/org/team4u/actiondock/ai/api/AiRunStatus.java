package org.team4u.actiondock.ai.api;

/**
 * Agent 运行状态。
 * <p>
 * 描述 AI Agent 一次完整运行的生命周期状态，从启动到终态的完整状态流转。
 * 终态包括成功、失败、取消和中断。
 *
 * @author jay.wu
 */
public enum AiRunStatus {
    /** 运行中，Agent 正在执行任务 */
    RUNNING,
    /** 运行成功，Agent 已完成所有任务步骤 */
    SUCCESS,
    /** 运行失败，Agent 执行过程中遇到错误 */
    FAILED,
    /** 等待审批，Agent 需要用户确认后方可继续执行 */
    WAITING_APPROVAL,
    /** 已取消，运行被用户主动取消 */
    CANCELLED,
    /** 已中断，运行因外部原因（如超时、系统关闭）被中断 */
    INTERRUPTED
}
