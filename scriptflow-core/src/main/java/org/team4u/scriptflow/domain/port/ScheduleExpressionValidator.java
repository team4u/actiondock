package org.team4u.scriptflow.domain.port;

/**
 * 调度表达式校验器端口，验证 Cron 表达式的合法性。
 *
 * @author jay.wu
 */
@FunctionalInterface
public interface ScheduleExpressionValidator {
    void validate(String expression);
}
