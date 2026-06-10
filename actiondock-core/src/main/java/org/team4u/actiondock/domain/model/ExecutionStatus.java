package org.team4u.actiondock.domain.model;

/**
 * 脚本执行状态枚举，定义执行记录的生命周期状态。
 *
 * @author jay.wu
 */
public enum ExecutionStatus {
    /** 等待执行，任务已提交但尚未开始 */
    PENDING,
    /** 正在执行，脚本正在运行中 */
    RUNNING,
    /** 执行成功，脚本正常完成 */
    SUCCESS,
    /** 执行失败，脚本执行过程中发生错误 */
    FAILED,
    /** 执行已取消，由用户或系统主动终止 */
    CANCELED
}
