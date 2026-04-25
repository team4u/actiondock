package org.team4u.actiondock.web;

import org.team4u.actiondock.application.InvalidExecutionInputException;
import org.team4u.actiondock.application.ErrorDetailSupport;
import org.team4u.actiondock.domain.model.ErrorDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 全局异常处理器，将异常转换为统一的 API 响应格式。
 *
 * @author jay.wu
 */
@RestControllerAdvice
public class GlobalExceptionHandler {
    /**
     * 处理脚本执行输入校验异常，返回 400 响应及字段级错误详情。
     *
     * @param exception 输入校验异常
     * @return 400 响应，包含校验错误详情
     */
    @ExceptionHandler(InvalidExecutionInputException.class)
    public ResponseEntity<ApiResponse<ValidationErrorResponse>> handleInvalidExecutionInput(InvalidExecutionInputException exception) {
        ValidationErrorResponse data = new ValidationErrorResponse(
                exception.getCode(),
                exception.getScriptId(),
                exception.getFieldErrors()
        );
        return ResponseEntity.badRequest().body(ApiResponse.error(exception.getMessage(), 400, data));
    }

    /**
     * 处理非法参数异常，返回 400 响应及错误摘要。
     *
     * @param exception 非法参数异常
     * @return 400 响应，包含错误详情
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<ErrorDetail>> handleIllegalArgument(IllegalArgumentException exception) {
        return ResponseEntity.badRequest().body(ApiResponse.error(
                ErrorDetailSupport.summarize(exception),
                400,
                ErrorDetailSupport.describe(exception)
        ));
    }

    /**
     * 兜底异常处理，捕获所有未处理的异常并返回 500 响应。
     *
     * @param exception 未预期的异常
     * @return 500 响应，包含错误详情
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<ErrorDetail>> handleException(Exception exception) {
        return ResponseEntity.internalServerError().body(ApiResponse.error(
                ErrorDetailSupport.summarize(exception),
                500,
                ErrorDetailSupport.describe(exception)
        ));
    }
}
