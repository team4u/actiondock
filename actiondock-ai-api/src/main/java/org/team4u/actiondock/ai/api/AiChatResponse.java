package org.team4u.actiondock.ai.api;

import java.util.Map;

/**
 * AI 聊天响应。
 * <p>
 * 封装 AI 模型聊天调用的返回结果，包含文本内容、令牌使用量及原始响应数据。
 *
 * @param data  模型返回的文本内容
 * @param usage 本次调用的令牌使用量统计
 * @param raw   模型提供商返回的原始响应数据
 * @author jay.wu
 */
public record AiChatResponse(String data, AiUsage usage, Map<String, Object> raw) {
}
