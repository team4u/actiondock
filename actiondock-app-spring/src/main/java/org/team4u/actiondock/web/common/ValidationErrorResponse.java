package org.team4u.actiondock.web.common;

import org.team4u.actiondock.application.SchemaFieldError;

import java.util.List;

/**
 * 输入参数校验错误响应。
 *
 * @author jay.wu
 */
public record ValidationErrorResponse(
        String code,
        String scriptId,
        List<SchemaFieldError> fieldErrors
) {
}
