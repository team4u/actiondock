package org.team4u.actiondock.domain.model;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 错误详情，记录脚本执行过程中的异常信息。
 *
 * @author jay.wu
 */
public class ErrorDetail {
    private String type;
    private String stackTrace;
    private Map<String, Object> details = new LinkedHashMap<>();

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

    public Map<String, Object> getDetails() {
        return Map.copyOf(details);
    }

    public ErrorDetail setDetails(Map<String, Object> details) {
        this.details = details == null ? new LinkedHashMap<>() : new LinkedHashMap<>(details);
        return this;
    }
}
