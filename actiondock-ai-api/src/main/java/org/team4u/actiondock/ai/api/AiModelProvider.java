package org.team4u.actiondock.ai.api;

/**
 * AI 模型提供商枚举。
 * <p>
 * 定义支持的 AI 模型服务提供商，用于配置和路由不同厂商的模型调用。
 *
 * @author jay.wu
 */
public enum AiModelProvider {
    /** 阿里云 DashScope（通义千问） */
    DASHSCOPE,
    /** OpenAI（GPT 系列） */
    OPENAI,
    /** OpenAI 兼容接口（第三方代理） */
    OPENAI_COMPATIBLE,
    /** Anthropic（Claude 系列） */
    ANTHROPIC,
    /** Google Gemini */
    GEMINI,
    /** Ollama（本地模型） */
    OLLAMA
}
