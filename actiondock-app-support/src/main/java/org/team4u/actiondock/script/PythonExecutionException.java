package org.team4u.actiondock.script;

import org.team4u.actiondock.application.StructuredExecutionException;
import org.team4u.actiondock.domain.model.ErrorDetail;

/**
 * Python 运行时准备或执行失败时抛出的异常，携带结构化错误详情。
 */
final class PythonExecutionException extends StructuredExecutionException {
    PythonExecutionException(String message, ErrorDetail detail) {
        super(message, detail);
    }

    PythonExecutionException(String message, Throwable cause, ErrorDetail detail) {
        super(message, cause, detail);
    }
}
