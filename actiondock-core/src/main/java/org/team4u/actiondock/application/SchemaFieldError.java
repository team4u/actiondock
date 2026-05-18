package org.team4u.actiondock.application;

/**
 * 模式字段校验错误，记录单个字段的校验失败详情。
 *
 * @author jay.wu
 */
public record SchemaFieldError(
        String field,
        String reason,
        String message,
        String expected,
        String actual
) {
    /**
     * 创建模式字段校验错误。
     *
     * @param field    字段名称
     * @param reason   校验失败原因（如 required、type_mismatch、enum_mismatch）
     * @param message  人类可读的错误描述信息
     * @param expected 期望的类型或值
     * @param actual   实际的类型或值
     */
    public SchemaFieldError {
    }
}
