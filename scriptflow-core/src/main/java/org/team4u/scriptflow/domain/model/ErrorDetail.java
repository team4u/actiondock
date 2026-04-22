package org.team4u.scriptflow.domain.model;

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
