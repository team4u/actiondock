package org.team4u.actiondock.browser.plugin;

import com.microsoft.playwright.PlaywrightException;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.util.LinkedHashMap;
import java.util.Map;

final class BrowserErrors {
    private BrowserErrors() {
    }

    static PluginRuntimeException invalid(String action, String message) {
        return invalid(action, message, null);
    }

    static PluginRuntimeException invalid(String action, String message, Throwable cause) {
        return new PluginRuntimeException(
                400,
                "PLUGIN_INVALID_ARGUMENTS",
                message,
                Map.of("action", action),
                cause
        );
    }

    static PluginRuntimeException failed(String action, String message, Throwable cause) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("action", action);
        if (cause != null) {
            details.put("causeType", cause.getClass().getName());
        }
        return new PluginRuntimeException(422, "PLUGIN_ACTION_FAILED", message, details, cause);
    }

    static PluginRuntimeException wrap(String action, Exception exception) {
        if (exception instanceof PluginRuntimeException pluginRuntimeException) {
            return pluginRuntimeException;
        }
        String message = exception.getMessage() == null || exception.getMessage().isBlank()
                ? exception.getClass().getSimpleName()
                : exception.getMessage();
        if (exception instanceof IllegalArgumentException) {
            return invalid(action, message, exception);
        }
        if (exception instanceof PlaywrightException || exception instanceof IllegalStateException) {
            return failed(action, message, exception);
        }
        return failed(action, message, exception);
    }
}
