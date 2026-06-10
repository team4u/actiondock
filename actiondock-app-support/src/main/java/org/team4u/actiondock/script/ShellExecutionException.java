package org.team4u.actiondock.script;

import java.util.Map;

/**
 * Raised when shell.exec is configured to fail fast and the command fails.
 */
public class ShellExecutionException extends RuntimeException {
    private final Map<String, Object> result;

    ShellExecutionException(String message, Map<String, Object> result) {
        super(message);
        this.result = result == null ? Map.of() : Map.copyOf(result);
    }

    public Map<String, Object> getResult() {
        return result;
    }
}
