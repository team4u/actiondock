package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Map;

/**
 * AI 结构化输出请求。
 * <p>
 * 封装要求 AI 模型按照指定 JSON Schema 输出结构化数据的请求，
 * 用于需要严格格式化响应的场景（如信息抽取、表单填充）。
 *
 * @param modelProfile 模型配置名称，用于路由到具体的模型提供商和参数
 * @param messages     对话消息列表，按顺序组成上下文
 * @param outputSchema 期望输出的 JSON Schema 定义
 * @param options      可选参数，如温度、最大令牌数等模型调用参数
 * @author jay.wu
 */
public record AiStructuredRequest(
        String modelProfile,
        List<AiMessage> messages,
        Map<String, Object> outputSchema,
        Map<String, Object> options
) {
}
