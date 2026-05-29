package org.team4u.actiondock.ai.api;

/**
 * AI 调用方类型枚举。
 * <p>
 * 定义发起 AI 调用的来源类型，用于区分不同场景下的 AI 能力调用，便于权限控制和调用追踪。
 *
 * @author jay.wu
 */
public enum AiCallerType {
    /** 脚本调用 */
    SCRIPT,
    /** 插件调用 */
    PLUGIN,
    /** 管理后台测试调用 */
    ADMIN_TEST,
    /** Agent 自动调用 */
    AGENT
}
