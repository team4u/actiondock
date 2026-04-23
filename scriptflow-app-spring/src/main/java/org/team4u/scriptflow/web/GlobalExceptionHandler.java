package org.team4u.scriptflow.web;

import org.team4u.scriptflow.application.InvalidExecutionInputException;
import org.team4u.scriptflow.application.ErrorDetailSupport;
import org.team4u.scriptflow.domain.model.ErrorDetail;
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
    @ExceptionHandler(InvalidExecutionInputException.class)
    public ResponseEntity<ApiResponse<ValidationErrorResponse>> handleInvalidExecutionInput(InvalidExecutionInputException exception) {
        ValidationErrorResponse data = new ValidationErrorResponse(
                exception.getCode(),
                exception.getScriptId(),
                exception.getFieldErrors()
        );
        return ResponseEntity.badRequest().body(ApiResponse.error(exception.getMessage(), 400, data));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<ErrorDetail>> handleIllegalArgument(IllegalArgumentException exception) {
        return ResponseEntity.badRequest().body(ApiResponse.error(
                ErrorDetailSupport.summarize(exception),
                400,
                ErrorDetailSupport.describe(exception)
        ));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<ErrorDetail>> handleException(Exception exception) {
        return ResponseEntity.internalServerError().body(ApiResponse.error(
                ErrorDetailSupport.summarize(exception),
                500,
                ErrorDetailSupport.describe(exception)
        ));
    }
}
