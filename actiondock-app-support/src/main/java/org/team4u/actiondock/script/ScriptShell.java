package org.team4u.actiondock.script;

import org.team4u.actiondock.common.shell.ShellExecutionOptions;
import org.team4u.actiondock.common.shell.ShellExecutionResult;
import org.team4u.actiondock.common.shell.ShellSupport;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 脚本可访问的 Shell 命令执行器，供 Groovy 和 Python 脚本共享。
 * <p>
 * 提供命令拼接（join）和命令执行（exec）能力，执行过程受应用配置约束。
 *
 * @author jay.wu
 */
public class ScriptShell {
    private final AppProperties properties;
    private final ShellSupport shellSupport;

    public ScriptShell(AppProperties properties, ScriptExecutionContext executionContext) {
        this.properties = properties == null ? new AppProperties() : properties;
        this.shellSupport = new ShellSupport();
    }

    public Map<String, Object> exec(String command) {
        return exec(command, Map.of());
    }

    public Map<String, Object> exec(String command, Map<String, Object> options) {
        Map<String, Object> effectiveOptions = options == null ? Map.of() : options;
        boolean check = booleanOption(effectiveOptions.get("check"), true);
        ShellExecutionResult result = shellSupport.exec(command, executionOptions(effectiveOptions));
        Map<String, Object> mapped = resultMap(result);
        if (check && !result.ok()) {
            throw new ShellExecutionException(buildFailureMessage(command, mapped), mapped);
        }
        return mapped;
    }

    public String quote(Object value) {
        return quote(value, Map.of());
    }

    public String quote(Object value, Map<String, Object> options) {
        return shellSupport.quote(value, options == null ? null : stringOption(options.get("shell")));
    }

    public String join(List<?> args) {
        return join(args, Map.of());
    }

    public String join(List<?> args, Map<String, Object> options) {
        return shellSupport.join(args, options == null ? null : stringOption(options.get("shell")));
    }

    String shellCommandPayload(String shell, String command) {
        return shellSupport.shellCommandPayload(shell, command);
    }

    private ShellExecutionOptions executionOptions(Map<String, Object> options) {
        return new ShellExecutionOptions(
                resolveCwd(options.get("cwd")),
                envMap(options.get("env")),
                intOption(options.get("timeoutSeconds"), properties.getExecution().getShell().getTimeoutSeconds()),
                intOption(options.get("maxOutputBytes"), properties.getExecution().getShell().getMaxOutputBytes()),
                stringOption(options.get("shell"))
        );
    }

    private Path resolveCwd(Object value) {
        if (value == null || String.valueOf(value).isBlank()) {
            return Path.of("").toAbsolutePath().normalize();
        }
        Path cwd = Path.of(String.valueOf(value));
        return cwd.isAbsolute() ? cwd.normalize() : cwd.toAbsolutePath().normalize();
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

    private static String stringOption(Object value) {
        return value == null ? null : String.valueOf(value);
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

    static Map<String, Object> resultMap(ShellExecutionResult result) {
        Map<String, Object> mapped = new LinkedHashMap<>();
        mapped.put("command", result.command());
        mapped.put("cwd", result.cwd().toString());
        mapped.put("shell", result.shell());
        mapped.put("durationMs", result.durationMs());
        mapped.put("ok", result.ok());
        mapped.put("exitCode", result.exitCode());
        mapped.put("stdout", result.stdout());
        mapped.put("stderr", result.stderr());
        mapped.put("timedOut", result.timedOut());
        mapped.put("stdoutTruncated", result.stdoutTruncated());
        mapped.put("stderrTruncated", result.stderrTruncated());
        return mapped;
    }

    private static String buildFailureMessage(String command, Map<String, Object> result) {
        if (Boolean.TRUE.equals(result.get("timedOut"))) {
            return "Shell command timed out: " + command;
        }
        return "Shell command failed: " + command + " (exitCode=" + result.get("exitCode") + ")";
    }
}
