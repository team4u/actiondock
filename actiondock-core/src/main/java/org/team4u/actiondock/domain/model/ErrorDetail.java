package org.team4u.actiondock.domain.model;

/**
 * 错误详情，记录脚本执行过程中的异常信息。
 *
 * @author jay.wu
 */
public class ErrorDetail {
    private String type;
    private String stackTrace;

    public String getType() {
        return type;
    }

    public ErrorDetail setType(String type) {
        this.type = type;
        return this;
    }

    public String getStackTrace() {
        return stackTrace;
    }

    public ErrorDetail setStackTrace(String stackTrace) {
        this.stackTrace = stackTrace;
        return this;
    }
}
