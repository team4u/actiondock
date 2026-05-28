package org.team4u.actiondock.common.shell;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

public record ShellExecutionOptions(Path cwd,
                                    Map<String, String> env,
                                    int timeoutSeconds,
                                    int maxOutputBytes,
                                    String shell) {
    public static final int DEFAULT_TIMEOUT_SECONDS = 30;
    public static final int DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

    public ShellExecutionOptions {
        cwd = cwd == null ? Path.of("").toAbsolutePath().normalize() : cwd.toAbsolutePath().normalize();
        env = env == null ? Map.of() : new LinkedHashMap<>(env);
        timeoutSeconds = Math.max(1, timeoutSeconds <= 0 ? DEFAULT_TIMEOUT_SECONDS : timeoutSeconds);
        maxOutputBytes = Math.max(1, maxOutputBytes <= 0 ? DEFAULT_MAX_OUTPUT_BYTES : maxOutputBytes);
        shell = ShellSupport.normalizeShell(shell);
    }

    public static ShellExecutionOptions defaults() {
        return new ShellExecutionOptions(
                Path.of("").toAbsolutePath().normalize(),
                Map.of(),
                DEFAULT_TIMEOUT_SECONDS,
                DEFAULT_MAX_OUTPUT_BYTES,
                ShellSupport.AUTO
        );
    }
}
