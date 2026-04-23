package org.team4u.scriptflow.application;

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
}
