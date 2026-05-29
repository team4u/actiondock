package org.team4u.actiondock.ai.api;

import java.util.Map;

/**
 * AI 结构化输出响应。
 * <p>
 * 封装 AI 模型结构化调用的返回结果，包含解析后的结构化数据、令牌使用量及原始响应。
 *
 * @param data  模型返回的结构化数据（符合请求中指定的 JSON Schema）
 * @param usage 本次调用的令牌使用量统计
 * @param raw   模型提供商返回的原始响应数据
 * @author jay.wu
 */
public record AiStructuredResponse(Map<String, Object> data, AiUsage usage, Map<String, Object> raw) {
}
