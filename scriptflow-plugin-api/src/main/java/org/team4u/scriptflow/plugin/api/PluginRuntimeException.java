package org.team4u.scriptflow.plugin.api;

public class PluginRuntimeException extends RuntimeException {
    public PluginRuntimeException(String message) {
        super(message);
    }

    public PluginRuntimeException(String message, Throwable cause) {
        super(message, cause);
    }
}
