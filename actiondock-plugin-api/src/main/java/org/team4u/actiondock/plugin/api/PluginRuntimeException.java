package org.team4u.actiondock.plugin.api;

/**
 * 插件运行时异常，封装插件执行过程中的非受检错误。
 *
 * @author jay.wu
 */
public class PluginRuntimeException extends RuntimeException {
    private final int status;
    private final String code;
    private final java.util.Map<String, Object> details;

    public PluginRuntimeException(String message) {
        this(message, null);
    }

    public PluginRuntimeException(String message, Throwable cause) {
        super(message, cause);
        this.status = 500;
        this.code = "PLUGIN_ACTION_FAILED";
        this.details = java.util.Map.of();
    }

    public PluginRuntimeException(int status, String code, String message) {
        this(status, code, message, java.util.Map.of(), null);
    }

    public PluginRuntimeException(int status, String code, String message, java.util.Map<String, Object> details) {
        this(status, code, message, details, null);
    }

    public PluginRuntimeException(int status,
                                  String code,
                                  String message,
                                  java.util.Map<String, Object> details,
                                  Throwable cause) {
        super(message, cause);
        this.status = status;
        this.code = code == null || code.isBlank() ? "PLUGIN_ACTION_FAILED" : code;
        this.details = details == null ? java.util.Map.of() : new java.util.LinkedHashMap<>(details);
    }

    public int getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    public java.util.Map<String, Object> getDetails() {
        return new java.util.LinkedHashMap<>(details);
    }
}
