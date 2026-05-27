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
        return new PluginRuntimeException(500, "PLUGIN_ACTION_FAILED", message, details, cause);
    }

    static PluginRuntimeException blocked(String action, String category, String message, Throwable cause) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("action", action);
        details.put("reason", "ACTION_BLOCKED");
        if (!Args.isBlank(category)) {
            details.put("category", category);
        }
        return new PluginRuntimeException(403, "PLUGIN_ACTION_BLOCKED", message, details, cause);
    }

    static PluginRuntimeException staleRef(String action, BrowserRefStaleException exception) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("action", action);
        details.put("reason", "REF_STALE");
        details.put("ref", exception.ref());
        details.put("pageId", exception.pageId());
        details.put("expectedSnapshotId", exception.expectedSnapshotId());
        details.put("currentSnapshotId", exception.currentSnapshotId());
        details.put("pageVersion", exception.pageVersion());
        return new PluginRuntimeException(409, "PLUGIN_REF_STALE", exception.getMessage(), details, exception);
    }

    static PluginRuntimeException wrap(String action, Exception exception) {
        if (exception instanceof PluginRuntimeException pluginRuntimeException) {
            return pluginRuntimeException;
        }
        if (exception instanceof BrowserRefStaleException staleException) {
            return staleRef(action, staleException);
        }
        if (exception instanceof BrowserActionBlockedException blockedException) {
            return blocked(action, blockedException.category(), blockedException.getMessage(), blockedException);
        }
        String message = exception.getMessage() == null || exception.getMessage().isBlank()
                ? exception.getClass().getSimpleName()
                : exception.getMessage();
        if (exception instanceof IllegalArgumentException) {
            return invalid(action, message, exception);
        }
        return failed(action, message, exception);
    }
}
