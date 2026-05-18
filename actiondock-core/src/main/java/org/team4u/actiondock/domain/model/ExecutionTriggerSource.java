package org.team4u.actiondock.domain.model;

/**
 * 执行触发来源，标识脚本执行是由用户手动触发还是定时调度触发。
 *
 * @author jay.wu
 */
public enum ExecutionTriggerSource {
    MANUAL,
    SCHEDULED,
    AI_TOOL,
    EVENT,
    WEBHOOK
}
