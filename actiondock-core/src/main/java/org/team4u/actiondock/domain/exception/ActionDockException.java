package org.team4u.actiondock.domain.exception;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * API-visible business exception carrying stable error metadata.
 */
public class ActionDockException extends IllegalArgumentException {
    private final int status;
    private final String code;
    private final Map<String, Object> details;

    public ActionDockException(int status, String code, String message) {
        this(status, code, message, null);
    }

    public ActionDockException(int status, String code, String message, Map<String, Object> details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details == null ? new LinkedHashMap<>() : new LinkedHashMap<>(details);
    }

    public static ActionDockException badRequest(String code, String message, Map<String, Object> details) {
        return new ActionDockException(400, code, message, details);
    }

    public static ActionDockException notFound(String code, String message, Map<String, Object> details) {
        return new ActionDockException(404, code, message, details);
    }

    public static ActionDockException conflict(String code, String message, Map<String, Object> details) {
        return new ActionDockException(409, code, message, details);
    }

    public int getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    public Map<String, Object> getDetails() {
        return new LinkedHashMap<>(details);
    }

    public Map<String, Object> toResponseData() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("code", code);
        data.putAll(details);
        return data;
    }
}
