package org.team4u.scriptflow.web;

import org.team4u.scriptflow.application.InvalidExecutionInputException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

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
    public ResponseEntity<ApiResponse<Void>> handleIllegalArgument(IllegalArgumentException exception) {
        return ResponseEntity.badRequest().body(ApiResponse.error(exception.getMessage(), 400));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleException(Exception exception) {
        return ResponseEntity.internalServerError().body(ApiResponse.error(exception.getMessage(), 500));
    }
}
