package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.ErrorDetail;

/**
 * 携带结构化错误详情的执行异常。
 */
public class StructuredExecutionException extends IllegalStateException {
    private final ErrorDetail detail;

    public StructuredExecutionException(String message, ErrorDetail detail) {
        super(message);
        this.detail = detail;
    }

    public StructuredExecutionException(String message, Throwable cause, ErrorDetail detail) {
        super(message, cause);
        this.detail = detail;
    }

    public ErrorDetail getDetail() {
        return detail;
    }
}
