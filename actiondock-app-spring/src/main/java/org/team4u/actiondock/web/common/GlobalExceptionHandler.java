package org.team4u.actiondock.web.common;

import org.team4u.actiondock.application.InvalidExecutionInputException;
import org.team4u.actiondock.application.ErrorDetailSupport;
import org.team4u.actiondock.application.EventAuthenticationException;
import org.team4u.actiondock.application.InvalidPythonRequirementsException;
import org.team4u.actiondock.application.WebhookRequestHeadersTooLargeException;
import org.team4u.actiondock.application.WebhookRequestPayloadTooLargeException;
import org.team4u.actiondock.domain.exception.UpstreamConflictException;
import org.team4u.actiondock.domain.exception.RepositoryPluginConflictException;
import org.team4u.actiondock.domain.exception.RepositoryVersionExistsException;
import org.team4u.actiondock.domain.model.ErrorDetail;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

/**
 * 全局异常处理器，将异常转换为统一的 API 响应格式。
 *
 * @author jay.wu
 */
@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger LOGGER = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /**
     * 处理脚本执行输入校验异常，返回 400 响应及字段级错误详情。
     *
     * @param exception 输入校验异常
     * @return 400 响应，包含校验错误详情
     */
    @ExceptionHandler(InvalidExecutionInputException.class)
    public ResponseEntity<ApiResponse<ValidationErrorResponse>> handleInvalidExecutionInput(InvalidExecutionInputException exception,
                                                                                           HttpServletRequest request) {
        ValidationErrorResponse data = new ValidationErrorResponse(
                exception.getCode(),
                exception.getScriptId(),
                exception.getFieldErrors()
        );
        logException(exception, 400, request);
        return ResponseEntity.badRequest().body(ApiResponse.error(exception.getMessage(), 400, data));
    }

    @ExceptionHandler(InvalidScriptPatchException.class)
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleInvalidScriptPatch(InvalidScriptPatchException exception,
                                                                                    HttpServletRequest request) {
        logException(exception, 400, request);
        return ResponseEntity.badRequest().body(ApiResponse.error(
                exception.getMessage(),
                400,
                Map.of(
                        "code", "INVALID_SCRIPT_PATCH",
                        "scriptId", exception.getScriptId(),
                        "rejectedFields", exception.getRejectedFields(),
                        "allowedFields", exception.getAllowedFields()
                )
        ));
    }

    @ExceptionHandler(InvalidPythonRequirementsException.class)
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleInvalidPythonRequirements(InvalidPythonRequirementsException exception,
                                                                                           HttpServletRequest request) {
        logException(exception, 400, request);
        return ResponseEntity.badRequest().body(ApiResponse.error(
                exception.getMessage(),
                400,
                exception.toResponseData()
        ));
    }

    /**
     * 处理非法参数异常，返回 400 响应及错误摘要。
     *
     * @param exception 非法参数异常
     * @return 400 响应，包含错误详情
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<ErrorDetail>> handleIllegalArgument(IllegalArgumentException exception,
                                                                         HttpServletRequest request) {
        return errorDetailResponse(exception, 400, request);
    }

    @ExceptionHandler(EventAuthenticationException.class)
    public ResponseEntity<ApiResponse<ErrorDetail>> handleEventAuthentication(EventAuthenticationException exception,
                                                                             HttpServletRequest request) {
        return errorDetailResponse(exception, 401, request);
    }

    @ExceptionHandler(WebhookRequestPayloadTooLargeException.class)
    public ResponseEntity<ApiResponse<ErrorDetail>> handleWebhookRequestPayloadTooLarge(WebhookRequestPayloadTooLargeException exception,
                                                                                       HttpServletRequest request) {
        return errorDetailResponse(exception, 413, request);
    }

    @ExceptionHandler(WebhookRequestHeadersTooLargeException.class)
    public ResponseEntity<ApiResponse<ErrorDetail>> handleWebhookRequestHeadersTooLarge(WebhookRequestHeadersTooLargeException exception,
                                                                                       HttpServletRequest request) {
        return errorDetailResponse(exception, 431, request);
    }

    @ExceptionHandler(RepositoryPluginConflictException.class)
    public ResponseEntity<ApiResponse<Map<String, Object>>> handlePluginConflict(RepositoryPluginConflictException exception,
                                                                                HttpServletRequest request) {
        logException(exception, 400, request);
        return ResponseEntity.badRequest().body(ApiResponse.error(
                exception.getMessage(),
                400,
                Map.of(
                        "code", "PLUGIN_VERSION_CONFLICT",
                        "pluginId", exception.getPluginId(),
                        "conflicts", exception.getConflicts()
                )
        ));
    }

    @ExceptionHandler(RepositoryVersionExistsException.class)
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleRepositoryVersionExists(RepositoryVersionExistsException exception,
                                                                                         HttpServletRequest request) {
        logException(exception, 400, request);
        return ResponseEntity.badRequest().body(ApiResponse.error(
                exception.getMessage(),
                400,
                Map.of(
                        "code", "REPOSITORY_VERSION_EXISTS",
                        "assetKind", exception.getAssetKind(),
                        "repositoryId", exception.getRepositoryId(),
                        "assetId", exception.getAssetId(),
                        "version", exception.getVersion()
                )
        ));
    }

    @ExceptionHandler(UpstreamConflictException.class)
    public ResponseEntity<ApiResponse<Map<String, Object>>> handleUpstreamConflict(UpstreamConflictException exception,
                                                                                  HttpServletRequest request) {
        logException(exception, 400, request);
        return ResponseEntity.badRequest().body(ApiResponse.error(
                exception.getMessage(),
                400,
                Map.of(
                        "code", "UPSTREAM_CONFLICT",
                        "localAssetId", exception.getLocalAssetId(),
                        "repositoryId", exception.getRepositoryId(),
                        "upstreamAssetId", exception.getUpstreamAssetId()
                )
        ));
    }

    /**
     * 兜底异常处理，捕获所有未处理的异常并返回 500 响应。
     *
     * @param exception 未预期的异常
     * @return 500 响应，包含错误详情
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<ErrorDetail>> handleException(Exception exception,
                                                                   HttpServletRequest request) {
        return errorDetailResponse(exception, 500, request);
    }

    private static ResponseEntity<ApiResponse<ErrorDetail>> errorDetailResponse(Exception exception,
                                                                               int status,
                                                                               HttpServletRequest request) {
        logException(exception, status, request);
        return ResponseEntity.status(status).body(ApiResponse.error(
                ErrorDetailSupport.summarize(exception),
                status,
                ErrorDetailSupport.describe(exception)
        ));
    }

    private static void logException(Exception exception, int status, HttpServletRequest request) {
        String method = request == null ? "-" : request.getMethod();
        String uri = request == null ? "-" : request.getRequestURI();
        String message = "API exception status=" + status + " method=" + method + " uri=" + uri + " message=" + ErrorDetailSupport.summarize(exception);
        if (status >= 500) {
            LOGGER.error(message, exception);
        } else {
            LOGGER.warn(message, exception);
        }
    }
}
