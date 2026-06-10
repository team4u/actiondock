package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Map;

/**
 * AI 聊天请求。
 * <p>
 * 封装发送给 AI 模型的聊天对话请求，包含模型配置、消息列表及可选参数。
 *
 * @param modelProfile 模型配置名称，用于路由到具体的模型提供商和参数
 * @param messages     对话消息列表，按顺序组成上下文
 * @param options      可选参数，如温度、最大令牌数等模型调用参数
 * @author jay.wu
 */
public record AiChatRequest(String modelProfile, List<AiMessage> messages, Map<String, Object> options) {
}
