package org.team4u.actiondock.domain.model;

/**
 * 脚本提交模式枚举，定义脚本执行的方式。
 *
 * @author jay.wu
 */
public enum SubmitMode {
    /** 同步模式，客户端等待脚本执行完成并返回结果 */
    SYNC,
    /** 异步模式，客户端提交后立即返回，执行结果通过回调通知 */
    ASYNC
}
