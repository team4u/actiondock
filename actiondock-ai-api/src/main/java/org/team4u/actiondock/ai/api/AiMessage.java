package org.team4u.actiondock.ai.api;

/**
 * AI 对话消息。
 * <p>
 * 表示与 AI 模型交互时的一条消息，包含角色标识和文本内容，
 * 通常用于构建多轮对话的上下文。
 *
 * @param role    消息角色，如 "user"、"assistant"、"system"
 * @param content 消息文本内容
 * @author jay.wu
 */
public record AiMessage(String role, String content) {
}
