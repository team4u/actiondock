package org.team4u.actiondock.project.knowledge.plugin.parser;

import java.util.Map;

/**
 * AI 输出解析结果。
 *
 * <p>封装 AI 原始输出的解析状态，提供解析成功和需要人工审核两种工厂方法。
 *
 * @param status      解析状态（{@code done} / {@code needs_review}）
 * @param rawOutput   原始 AI 输出
 * @param parsedOutput 解析后的结构化数据
 * @param parseError  解析错误信息
 */
public record ParsedAiOutput(
        String status,
        String rawOutput,
        Map<String, Object> parsedOutput,
        String parseError
) {
    /**
     * 创建解析成功的结果。
     *
     * @param rawOutput   原始输出
     * @param parsedOutput 解析后的结构化数据
     * @return 状态为 {@code done} 的解析结果
     */
    public static ParsedAiOutput done(String rawOutput, Map<String, Object> parsedOutput) {
        return new ParsedAiOutput("done", rawOutput, parsedOutput, null);
    }

    /**
     * 创建需要人工审核的结果。
     *
     * @param rawOutput 原始输出
     * @param parseError 解析错误描述
     * @param fallback  回退使用的备选数据
     * @return 状态为 {@code needs_review} 的解析结果
     */
    public static ParsedAiOutput needsReview(String rawOutput, String parseError, Map<String, Object> fallback) {
        return new ParsedAiOutput("needs_review", rawOutput, fallback, parseError);
    }

    /**
     * 判断是否解析成功。
     *
     * @return 状态为 {@code done} 时返回 {@code true}
     */
    public boolean parsed() {
        return "done".equals(status);
    }
}
