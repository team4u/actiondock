package org.team4u.actiondock.ai.api;

/**
 * AI 模型调用的令牌使用量统计。
 * <p>
 * 记录单次 AI 调用中输入、输出及总令牌消耗数量，用于费用核算和用量监控。
 *
 * @param inputTokens  输入令牌数
 * @param outputTokens 输出令牌数
 * @param totalTokens  总令牌数
 * @author jay.wu
 */
public record AiUsage(Integer inputTokens, Integer outputTokens, Integer totalTokens) {

    /**
     * 返回一个所有令牌数均为零的空使用量实例。
     *
     * @return 空使用量统计
     */
    public static AiUsage empty() {
        return new AiUsage(0, 0, 0);
    }
}
