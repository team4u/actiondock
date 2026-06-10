package org.team4u.actiondock.ai.api;

/**
 * AI Agent 运行观察者。
 * <p>
 * 定义 Agent 运行过程中的事件回调接口，用于流式输出文本增量和步骤完成通知。
 * 所有方法均有默认空实现，观察者可按需覆盖感兴趣的方法。
 *
 * @author jay.wu
 */
public interface AiAgentRunObserver {
    /** 空操作观察者，所有回调均为空实现 */
    AiAgentRunObserver NOOP = new AiAgentRunObserver() {
    };

    /**
     * 文本增量回调。
     * <p>
     * 当模型输出流式文本时触发，每次传入增量文本和已累积的完整文本。
     *
     * @param delta           本次增量文本
     * @param accumulatedText 截至当前的累积文本
     */
    default void onTextDelta(String delta, String accumulatedText) {
    }

    /**
     * 步骤完成回调。
     * <p>
     * 当 Agent 完成一个执行步骤（如模型调用或工具调用）时触发。
     *
     * @param step 已完成的执行步骤
     */
    default void onStep(AiAgentStep step) {
    }
}
