package org.team4u.actiondock.common.shell;

import java.nio.file.Path;
import java.util.List;

public record ShellExecutionResult(boolean ok,
                                   int exitCode,
                                   String stdout,
                                   String stderr,
                                   boolean timedOut,
                                   long durationMs,
                                   String command,
                                   Path cwd,
                                   List<String> shell,
                                   boolean stdoutTruncated,
                                   boolean stderrTruncated) {
}
