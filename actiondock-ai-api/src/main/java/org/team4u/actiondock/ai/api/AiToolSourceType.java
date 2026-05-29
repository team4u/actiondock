package org.team4u.actiondock.ai.api;

/**
 * AI 工具来源类型。
 * <p>
 * 标识 AI 工具的注册来源，用于区分系统内置工具、用户脚本注册的动态工具
 * 以及 Agent 运行时动态生成的工具。
 *
 * @author jay.wu
 */
public enum AiToolSourceType {
    /** 系统内置工具，随应用启动自动注册 */
    SYSTEM,
    /** 脚本注册的动态工具，由用户自定义脚本提供 */
    SCRIPT,
    /** Agent 运行时生成的工具，由 Agent 编排产生 */
    AGENT
}
