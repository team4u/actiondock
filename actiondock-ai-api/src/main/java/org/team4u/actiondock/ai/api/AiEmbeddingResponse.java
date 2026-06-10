package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Map;

/**
 * AI 向量嵌入响应。
 * <p>
 * 封装 AI 模型嵌入调用的返回结果，包含嵌入向量列表、令牌使用量及原始响应数据。
 *
 * @param data  模型返回的嵌入向量列表，每条输入对应一个向量
 * @param usage 本次调用的令牌使用量统计
 * @param raw   模型提供商返回的原始响应数据
 * @author jay.wu
 */
public record AiEmbeddingResponse(List<List<Double>> data, AiUsage usage, Map<String, Object> raw) {
}
