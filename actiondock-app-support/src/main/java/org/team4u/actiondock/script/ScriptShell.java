package org.team4u.actiondock.script;

import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Script-visible shell facade shared by Groovy and Python.
 */
public class ScriptShell {
    private static final String AUTO = "auto";
    private static final String BASH = "bash";
    private static final String SH = "sh";
    private static final String POWERSHELL = "powershell";
    private static final String CMD = "cmd";
    private static final String POWERSHELL_UTF8_BOOTSTRAP = String.join("; ",
            "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)",
            "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
            "$OutputEncoding = [System.Text.UTF8Encoding]::new($false)"
    );

    private final AppProperties properties;

    public ScriptShell(AppProperties properties, ScriptExecutionContext executionContext) {
        this.properties = properties == null ? new AppProperties() : properties;
    }

    public Map<String, Object> exec(String command) {
        return exec(command, Map.of());
    }

    public Map<String, Object> exec(String command, Map<String, Object> options) {
        String normalizedCommand = requireCommand(command);
        Map<String, Object> effectiveOptions = options == null ? Map.of() : options;
        Path cwd = resolveCwd(effectiveOptions.get("cwd"));
        ensureDirectory(cwd);
        int timeoutSeconds = intOption(
                effectiveOptions.get("timeoutSeconds"),
                properties.getExecution().getShell().getTimeoutSeconds()
        );
        int maxOutputBytes = intOption(
                effectiveOptions.get("maxOutputBytes"),
                properties.getExecution().getShell().getMaxOutputBytes()
        );
        boolean check = booleanOption(effectiveOptions.get("check"), true);
        String requestedShell = shellOption(effectiveOptions.get("shell"));

        Map<String, Object> result = runWithShellCandidates(
                normalizedCommand,
                cwd,
                envMap(effectiveOptions.get("env")),
                timeoutSeconds,
                maxOutputBytes,
                requestedShell
        );
        if (check && !Boolean.TRUE.equals(result.get("ok"))) {
            throw new ShellExecutionException(buildFailureMessage(normalizedCommand, result), result);
        }
        return result;
    }

    public String quote(Object value) {
        return quote(value, Map.of());
    }

    public String quote(Object value, Map<String, Object> options) {
        return quoteForShell(value == null ? "" : String.valueOf(value), shellOption(options == null ? null : options.get("shell")));
    }

    public String join(List<?> args) {
        return join(args, Map.of());
    }

    public String join(List<?> args, Map<String, Object> options) {
        if (args == null) {
            return "";
        }
        String shell = shellOption(options == null ? null : options.get("shell"));
        String effective = AUTO.equals(shell) ? (isWindows() ? POWERSHELL : BASH) : shell;
        if (POWERSHELL.equals(effective)) {
            return joinPowerShell(args);
        }
        return args.stream()
                .map(item -> quoteForShell(item == null ? "" : String.valueOf(item), effective))
                .reduce((left, right) -> left + " " + right)
                .orElse("");
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

    private Map<String, Object> runWithShellCandidates(String command,
                                                       Path cwd,
                                                       Map<String, String> env,
                                                       int timeoutSeconds,
                                                       int maxOutputBytes,
                                                       String requestedShell) {
        IOException lastStartError = null;
        for (ShellCommand shellCommand : shellCandidates(requestedShell)) {
            try {
                return runProcess(shellCommand, command, cwd, env, timeoutSeconds, maxOutputBytes);
            } catch (IOException exception) {
                lastStartError = exception;
                if (!AUTO.equals(requestedShell)) {
                    break;
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                return failedResult(command, cwd, shellCommand.command(), -1, "", exception.getMessage(), false, 0L);
            }
        }
        String stderr = lastStartError == null ? "No usable shell found." : lastStartError.getMessage();
        return failedResult(command, cwd, List.of(), -1, "", stderr, false, 0L);
    }

    private Map<String, Object> runProcess(ShellCommand shellCommand,
                                           String command,
                                           Path cwd,
                                           Map<String, String> env,
                                           int timeoutSeconds,
                                           int maxOutputBytes) throws IOException, InterruptedException {
        List<String> processCommand = new ArrayList<>(shellCommand.command());
        processCommand.add(renderCommandForShell(shellCommand.shell(), command));
        ProcessBuilder builder = new ProcessBuilder(processCommand);
        builder.directory(cwd.toFile());
        builder.environment().putAll(env);
        long started = System.currentTimeMillis();
        Process process = builder.start();

        ByteArrayOutputStream stdout = new ByteArrayOutputStream();
        ByteArrayOutputStream stderr = new ByteArrayOutputStream();
        Thread stdoutThread = streamCollector(process.getInputStream(), stdout, maxOutputBytes);
        Thread stderrThread = streamCollector(process.getErrorStream(), stderr, maxOutputBytes);

        boolean finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);
        if (!finished) {
            ProcessSupport.forceDestroyProcess(process);
        }
        stdoutThread.join(Duration.ofSeconds(1));
        stderrThread.join(Duration.ofSeconds(1));

        int exitCode = finished ? process.exitValue() : -1;
        String stdoutText = stdout.toString(StandardCharsets.UTF_8);
        String stderrText = stderr.toString(StandardCharsets.UTF_8);
        Map<String, Object> result = baseResult(command, cwd, shellCommand.command(), System.currentTimeMillis() - started);
        result.put("ok", finished && exitCode == 0);
        result.put("exitCode", exitCode);
        result.put("stdout", stdoutText);
        result.put("stderr", stderrText);
        result.put("timedOut", !finished);
        result.put("stdoutTruncated", stdout.size() >= maxOutputBytes);
        result.put("stderrTruncated", stderr.size() >= maxOutputBytes);
        return result;
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

    String shellCommandPayload(String shell, String command) {
        return renderCommandForShell(shellOption(shell), command);
    }

    private Path resolveCwd(Object value) {
        if (value == null || String.valueOf(value).isBlank()) {
            return Path.of("").toAbsolutePath().normalize();
        }
        Path cwd = Path.of(String.valueOf(value));
        return cwd.isAbsolute() ? cwd.normalize() : cwd.toAbsolutePath().normalize();
    }

    private void ensureDirectory(Path cwd) {
        if (!Files.isDirectory(cwd)) {
            throw new IllegalArgumentException("cwd is not a directory: " + cwd);
        }
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

    private static String shellOption(Object value) {
        if (value == null || String.valueOf(value).isBlank()) {
            return AUTO;
        }
        String shell = String.valueOf(value).trim().toLowerCase(Locale.ROOT);
        return switch (shell) {
            case AUTO, BASH, SH, POWERSHELL, CMD -> shell;
            default -> throw new IllegalArgumentException("Unsupported shell: " + shell);
        };
    }

    private static String requireCommand(String command) {
        if (NormalizeUtils.isBlank(command)) {
            throw new IllegalArgumentException("command is required");
        }
        return command;
    }

    private static int intOption(Object value, int defaultValue) {
        if (value == null) {
            return Math.max(1, defaultValue);
        }
        int parsed;
        if (value instanceof Number number) {
            parsed = number.intValue();
        } else {
            parsed = Integer.parseInt(String.valueOf(value));
        }
        return Math.max(1, parsed);
    }

    private static boolean booleanOption(Object value, boolean defaultValue) {
        if (value == null) {
            return defaultValue;
        }
        if (value instanceof Boolean bool) {
            return bool;
        }
        return Boolean.parseBoolean(String.valueOf(value));
    }

    private static Map<String, String> envMap(Object value) {
        Map<String, String> result = new LinkedHashMap<>();
        if (value instanceof Map<?, ?> map) {
            map.forEach((key, item) -> {
                if (key != null && item != null) {
                    result.put(String.valueOf(key), String.valueOf(item));
                }
            });
        }
        return result;
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }

    private Map<String, Object> failedResult(String command,
                                             Path cwd,
                                             List<String> shell,
                                             int exitCode,
                                             String stdout,
                                             String stderr,
                                             boolean timedOut,
                                             long durationMs) {
        Map<String, Object> result = baseResult(command, cwd, shell, durationMs);
        result.put("ok", false);
        result.put("exitCode", exitCode);
        result.put("stdout", stdout);
        result.put("stderr", stderr == null ? "" : stderr);
        result.put("timedOut", timedOut);
        result.put("stdoutTruncated", false);
        result.put("stderrTruncated", false);
        return result;
    }

    private Map<String, Object> baseResult(String command, Path cwd, List<String> shell, long durationMs) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("command", command);
        result.put("cwd", cwd.toString());
        result.put("shell", shell);
        result.put("durationMs", durationMs);
        return result;
    }

    private static String buildFailureMessage(String command, Map<String, Object> result) {
        if (Boolean.TRUE.equals(result.get("timedOut"))) {
            return "Shell command timed out: " + command;
        }
        return "Shell command failed: " + command + " (exitCode=" + result.get("exitCode") + ")";
    }

    private record ShellCommand(String shell, List<String> command) {
    }
}
