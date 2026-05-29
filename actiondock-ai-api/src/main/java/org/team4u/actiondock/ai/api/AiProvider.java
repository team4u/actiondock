package org.team4u.actiondock.ai.api;

/**
 * AI 服务提供商枚举。
 * <p>
 * 定义底层 AI 服务实现框架，当前仅支持 AgentScope。预留扩展能力以便接入其他 AI 框架。
 *
 * @author jay.wu
 */
public enum AiProvider {
    /** AgentScope 框架 */
    AGENTSCOPE
}
