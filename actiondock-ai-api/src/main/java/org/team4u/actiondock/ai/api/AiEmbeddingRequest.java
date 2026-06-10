package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Map;

/**
 * AI 向量嵌入请求。
 * <p>
 * 封装发送给 AI 模型的文本向量化请求，用于将文本转换为向量表示以支持语义搜索、相似度计算等场景。
 *
 * @param modelProfile 模型配置名称，用于路由到具体的嵌入模型
 * @param input        待嵌入的文本列表
 * @param options      可选参数，如维度等模型调用参数
 * @author jay.wu
 */
public record AiEmbeddingRequest(String modelProfile, List<String> input, Map<String, Object> options) {
}
