package org.team4u.actiondock.domain.port;

/**
 * 调度表达式校验器端口，验证 Cron 表达式的合法性。
 *
 * @author jay.wu
 */
@FunctionalInterface
public interface ScheduleExpressionValidator {

    /**
     * 校验调度表达式的合法性。
     * <p>
     * 验证给定的 Cron 表达式是否符合语法规则，确保调度引擎能够正确解析和执行。
     *
     * @param expression 待校验的 Cron 表达式
     * @throws IllegalArgumentException 表达式格式不合法时抛出
     */
    void validate(String expression);
}
