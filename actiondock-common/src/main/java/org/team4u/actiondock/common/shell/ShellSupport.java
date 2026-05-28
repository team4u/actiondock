package org.team4u.actiondock.common.shell;

import org.team4u.actiondock.common.NormalizeUtils;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

public class ShellSupport {
    public static final String AUTO = "auto";
    public static final String BASH = "bash";
    public static final String SH = "sh";
    public static final String POWERSHELL = "powershell";
    public static final String CMD = "cmd";

    private static final String POWERSHELL_UTF8_BOOTSTRAP = String.join("; ",
            "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)",
            "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
            "$OutputEncoding = [System.Text.UTF8Encoding]::new($false)"
    );

    public ShellExecutionResult exec(String command, ShellExecutionOptions options) {
        String normalizedCommand = requireCommand(command);
        ShellExecutionOptions effective = options == null ? ShellExecutionOptions.defaults() : options;
        ensureDirectory(effective.cwd());
        IOException lastStartError = null;
        for (ShellCommand shellCommand : shellCandidates(effective.shell())) {
            try {
                return runProcess(shellCommand, normalizedCommand, effective);
            } catch (IOException exception) {
                lastStartError = exception;
                if (!AUTO.equals(effective.shell())) {
                    break;
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                return failedResult(normalizedCommand, effective.cwd(), shellCommand.command(), -1, "", exception.getMessage(), false, 0L);
            }
        }
        String stderr = lastStartError == null ? "No usable shell found." : lastStartError.getMessage();
        return failedResult(normalizedCommand, effective.cwd(), List.of(), -1, "", stderr, false, 0L);
    }

    public String quote(Object value) {
        return quote(value, AUTO);
    }

    public String quote(Object value, String shell) {
        return quoteForShell(value == null ? "" : String.valueOf(value), normalizeShell(shell));
    }

    public String join(List<?> args) {
        return join(args, AUTO);
    }

    public String join(List<?> args, String shell) {
        if (args == null) {
            return "";
        }
        String effective = AUTO.equals(normalizeShell(shell)) ? (isWindows() ? POWERSHELL : BASH) : normalizeShell(shell);
        if (POWERSHELL.equals(effective)) {
            return joinPowerShell(args);
        }
        return args.stream()
                .map(item -> quoteForShell(item == null ? "" : String.valueOf(item), effective))
                .reduce((left, right) -> left + " " + right)
                .orElse("");
    }

    public String shellCommandPayload(String shell, String command) {
        return renderCommandForShell(normalizeShell(shell), command);
    }

    public static String normalizeShell(Object value) {
        if (value == null || String.valueOf(value).isBlank()) {
            return AUTO;
        }
        String shell = String.valueOf(value).trim().toLowerCase(Locale.ROOT);
        return switch (shell) {
            case AUTO, BASH, SH, POWERSHELL, CMD -> shell;
            default -> throw new IllegalArgumentException("Unsupported shell: " + shell);
        };
    }

    private ShellExecutionResult runProcess(ShellCommand shellCommand,
                                            String command,
                                            ShellExecutionOptions options) throws IOException, InterruptedException {
        List<String> processCommand = new ArrayList<>(shellCommand.command());
        processCommand.add(renderCommandForShell(shellCommand.shell(), command));
        ProcessBuilder builder = new ProcessBuilder(processCommand);
        builder.directory(options.cwd().toFile());
        builder.environment().putAll(options.env());
        long started = System.currentTimeMillis();
        Process process = builder.start();

        ByteArrayOutputStream stdout = new ByteArrayOutputStream();
        ByteArrayOutputStream stderr = new ByteArrayOutputStream();
        Thread stdoutThread = streamCollector(process.getInputStream(), stdout, options.maxOutputBytes());
        Thread stderrThread = streamCollector(process.getErrorStream(), stderr, options.maxOutputBytes());

        boolean finished = process.waitFor(options.timeoutSeconds(), TimeUnit.SECONDS);
        if (!finished) {
            forceDestroyProcess(process);
        }
        stdoutThread.join(Duration.ofSeconds(1));
        stderrThread.join(Duration.ofSeconds(1));

        int exitCode = finished ? process.exitValue() : -1;
        return new ShellExecutionResult(
                finished && exitCode == 0,
                exitCode,
                stdout.toString(StandardCharsets.UTF_8),
                stderr.toString(StandardCharsets.UTF_8),
                !finished,
                System.currentTimeMillis() - started,
                command,
                options.cwd(),
                shellCommand.command(),
                stdout.size() >= options.maxOutputBytes(),
                stderr.size() >= options.maxOutputBytes()
        );
    }

    private Thread streamCollector(InputStream inputStream, ByteArrayOutputStream output, int maxBytes) {
        Thread thread = new Thread(() -> {
            byte[] buffer = new byte[4096];
            try (inputStream) {
                int read;
                while ((read = inputStream.read(buffer)) >= 0) {
                    int remaining = maxBytes - output.size();
                    if (remaining > 0) {
                        output.write(buffer, 0, Math.min(read, remaining));
                    }
                }
            } catch (IOException ignored) {
                // Best-effort capture. Process exit code carries command status.
            }
        });
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    private List<ShellCommand> shellCandidates(String requestedShell) {
        if (!AUTO.equals(requestedShell)) {
            return List.of(shellCommand(requestedShell));
        }
        if (isWindows()) {
            return List.of(shellCommand(POWERSHELL), shellCommand(CMD));
        }
        if (Files.isExecutable(Path.of("/bin/bash"))) {
            return List.of(shellCommand(BASH), shellCommand(SH));
        }
        return List.of(shellCommand(SH));
    }

    private ShellCommand shellCommand(String shell) {
        return switch (shell) {
            case BASH -> new ShellCommand(shell, List.of("/bin/bash", "-lc"));
            case SH -> new ShellCommand(shell, List.of("/bin/sh", "-c"));
            case POWERSHELL -> new ShellCommand(shell, List.of(
                    "powershell.exe",
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command"
            ));
            case CMD -> new ShellCommand(shell, List.of("cmd.exe", "/d", "/s", "/c"));
            default -> throw new IllegalArgumentException("Unsupported shell: " + shell);
        };
    }

    private String renderCommandForShell(String shell, String command) {
        if (POWERSHELL.equals(shell)) {
            return POWERSHELL_UTF8_BOOTSTRAP + "; " + command;
        }
        return command;
    }

    private String joinPowerShell(List<?> args) {
        if (args.isEmpty()) {
            return "";
        }
        String command = args.getFirst() == null ? "" : String.valueOf(args.getFirst());
        StringBuilder builder = new StringBuilder(powerShellCommand(command));
        for (int index = 1; index < args.size(); index++) {
            builder.append(' ')
                    .append(quoteForPowerShell(args.get(index) == null ? "" : String.valueOf(args.get(index))));
        }
        return builder.toString();
    }

    private String powerShellCommand(String command) {
        if (isSimplePowerShellCommand(command)) {
            return command;
        }
        return "& " + quoteForPowerShell(command);
    }

    private String quoteForShell(String value, String shell) {
        String effective = AUTO.equals(shell) ? (isWindows() ? POWERSHELL : BASH) : shell;
        return switch (effective) {
            case POWERSHELL -> quoteForPowerShell(value);
            case CMD -> quoteForCmd(value);
            case BASH, SH -> "'" + value.replace("'", "'\"'\"'") + "'";
            default -> throw new IllegalArgumentException("Unsupported shell: " + shell);
        };
    }

    private String quoteForPowerShell(String value) {
        return "'" + value.replace("'", "''") + "'";
    }

    private String quoteForCmd(String value) {
        String escaped = value.replace("\"", "\\\"");
        return requiresCmdQuote(value) ? "\"" + escaped + "\"" : escaped;
    }

    private static boolean isSimplePowerShellCommand(String value) {
        return !NormalizeUtils.isBlank(value) && value.matches("[A-Za-z0-9_.:/\\\\-]+");
    }

    private static boolean requiresCmdQuote(String value) {
        if (value.isEmpty()) {
            return true;
        }
        for (int index = 0; index < value.length(); index++) {
            char ch = value.charAt(index);
            if (Character.isWhitespace(ch) || "&()[]{}^=;!'+,`~|<>\"".indexOf(ch) >= 0) {
                return true;
            }
        }
        return false;
    }

    private static String requireCommand(String command) {
        if (NormalizeUtils.isBlank(command)) {
            throw new IllegalArgumentException("command is required");
        }
        return command;
    }

    private static void ensureDirectory(Path cwd) {
        if (!Files.isDirectory(cwd)) {
            throw new IllegalArgumentException("cwd is not a directory: " + cwd);
        }
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }

    private static void forceDestroyProcess(Process process) throws InterruptedException {
        ProcessHandle handle = process.toHandle();
        handle.descendants().forEach(ProcessHandle::destroyForcibly);
        process.destroyForcibly();
        process.waitFor();
        handle.descendants().forEach(descendant -> {
            if (!descendant.isAlive()) {
                return;
            }
            try {
                descendant.onExit().get(1, TimeUnit.SECONDS);
            } catch (Exception ignored) {
                // Best-effort cleanup. The shell process itself has already exited.
            }
        });
    }

    private ShellExecutionResult failedResult(String command,
                                              Path cwd,
                                              List<String> shell,
                                              int exitCode,
                                              String stdout,
                                              String stderr,
                                              boolean timedOut,
                                              long durationMs) {
        return new ShellExecutionResult(
                false,
                exitCode,
                stdout,
                stderr == null ? "" : stderr,
                timedOut,
                durationMs,
                command,
                cwd,
                shell,
                false,
                false
        );
    }

    private record ShellCommand(String shell, List<String> command) {
    }
}
