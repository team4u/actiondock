package org.team4u.actiondock.ai.api;

/**
 * AI Agent 执行步骤状态常量。
 * <p>
 * 定义 Agent 运行过程中每个步骤的可能状态，用于跟踪执行进度和结果。
 *
 * @author jay.wu
 */
public final class AiStepStatus {

    /** 步骤正在执行中 */
    public static final String RUNNING = "RUNNING";
    /** 步骤执行成功 */
    public static final String SUCCESS = "SUCCESS";
    /** 步骤执行失败 */
    public static final String FAILED = "FAILED";

    private AiStepStatus() {
    }
}
