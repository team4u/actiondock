package org.team4u.scriptflow.script;

import org.team4u.scriptflow.config.AppProperties;
import org.team4u.scriptflow.domain.model.ExecutionLogLevel;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptExecutionContext;
import org.team4u.scriptflow.domain.port.JsonCodec;
import org.team4u.scriptflow.domain.port.ScriptEngine;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * Python 脚本引擎，通过子进程方式执行 Python 脚本。
 * <p>
 * 将用户脚本包装为标准化的 Python 入口函数，通过 stdin/stdout 传递 JSON 数据，
 * 并支持通过 stderr 的特殊前缀协议收集脚本日志。
 *
 * @author jay.wu
 */
public class PythonScriptEngine implements ScriptEngine {
    private static final String LOG_PREFIX = "__SCRIPTFLOW_LOG__";
    private static final String VALIDATION_RUNNER = """
            import py_compile
            import sys

            py_compile.compile(sys.argv[1], doraise=True)
            """;

    private final JsonCodec jsonCodec;
    private final AppProperties.Python properties;

    public PythonScriptEngine(JsonCodec jsonCodec, AppProperties.Python properties) {
        this.jsonCodec = Objects.requireNonNull(jsonCodec);
        this.properties = Objects.requireNonNull(properties);
    }

    @Override
    public void validate(ScriptDefinition definition) {
        Path scriptPath = null;
        try {
            scriptPath = writeScriptFile(definition.getSource(), false);
            ProcessResult result = runCommand(List.of(
                    resolveExecutable(),
                    "-c",
                    VALIDATION_RUNNER,
                    scriptPath.toAbsolutePath().toString()
            ), null, "{}", null);
            if (result.timedOut()) {
                throw new IllegalStateException("Python 脚本校验超时");
            }
            if (result.exitCode() != 0) {
                throw new IllegalArgumentException(extractErrorMessage(result));
            }
        } catch (IOException e) {
            throw new IllegalStateException("Failed to validate Python script", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Python validation interrupted", e);
        } finally {
            deleteIfExists(scriptPath);
        }
    }

    @Override
    public Object execute(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext) {
        Path scriptPath = null;
        try {
            scriptPath = writeScriptFile(definition.getSource(), true);
            ProcessResult result = runCommand(
                    List.of(resolveExecutable(), scriptPath.toAbsolutePath().toString()),
                    jsonCodec.write(input == null ? Map.of() : input),
                    jsonCodec.write(executionContext == null ? Map.of() : executionContext.getConfig()),
                    event -> {
                        if (executionContext != null) {
                            executionContext.log(event.level(), event.message());
                        }
                    }
            );
            if (result.timedOut()) {
                throw new IllegalStateException("Python 脚本执行超时");
            }
            if (result.exitCode() != 0) {
                throw new IllegalStateException(extractErrorMessage(result));
            }
            return jsonCodec.readUntyped(result.stdout());
        } catch (IOException e) {
            throw new IllegalStateException("Failed to execute Python script", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Python execution interrupted", e);
        } finally {
            deleteIfExists(scriptPath);
        }
    }

    private ProcessResult runCommand(List<String> command,
                                     String stdin,
                                     String configJson,
                                     Consumer<LogEvent> logConsumer)
            throws IOException, InterruptedException {
        ProcessBuilder processBuilder = new ProcessBuilder();
        processBuilder.command(command);
        processBuilder.environment().put("SCRIPTFLOW_CONFIG_JSON", configJson == null ? "{}" : configJson);
        Process process = processBuilder.start();
        CompletableFuture<String> stdoutFuture = CompletableFuture.supplyAsync(() -> readStream(process.getInputStream()));
        CompletableFuture<String> stderrFuture = CompletableFuture.supplyAsync(() ->
                readErrorStream(process.getErrorStream(), logConsumer == null ? event -> { } : logConsumer));

        try (OutputStream stdinStream = process.getOutputStream()) {
            if (stdin != null) {
                stdinStream.write(stdin.getBytes(StandardCharsets.UTF_8));
            }
        }

        boolean finished = process.waitFor(properties.getTimeoutSeconds(), TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            process.waitFor();
        }

        return new ProcessResult(
                finished ? process.exitValue() : -1,
                stdoutFuture.join(),
                stderrFuture.join(),
                !finished
        );
    }

    private String resolveExecutable() {
        if (properties.getExecutable() == null || properties.getExecutable().isBlank()) {
            return "python3";
        }
        return properties.getExecutable().trim();
    }

    private Path writeScriptFile(String source, boolean executable) throws IOException {
        Path scriptPath = Files.createTempFile("scriptflow-python-", ".py");
        String content = executable ? buildExecutableScript(source) : buildWrappedSource(source);
        Files.writeString(scriptPath, content, StandardCharsets.UTF_8);
        return scriptPath;
    }

    private String buildExecutableScript(String source) {
        return buildWrappedSource(source) + """

                if __name__ == "__main__":
                    payload_text = sys.stdin.read()
                    input = {} if not payload_text.strip() else json.loads(payload_text)
                    config_text = os.environ.get("SCRIPTFLOW_CONFIG_JSON", "")
                    config = {} if not config_text.strip() else json.loads(config_text)
                    result = __scriptflow_main(input)
                    json.dump(result, sys.stdout, ensure_ascii=False)
                """;
    }

    private String buildWrappedSource(String source) {
        String normalizedSource = source == null ? "" : source.replace("\r\n", "\n");
        if (normalizedSource.isBlank()) {
            normalizedSource = "return {}";
        }
        List<String> lines = new ArrayList<>();
        lines.add("import json");
        lines.add("import os");
        lines.add("import sys");
        lines.add("");
        lines.add("class __ScriptFlowLog:");
        lines.add("    def _write(self, level, message):");
        lines.add("        payload = json.dumps({\"level\": level, \"message\": str(message)}, ensure_ascii=False)");
        lines.add("        sys.stderr.write(\"" + LOG_PREFIX + "\" + payload + \"\\n\")");
        lines.add("        sys.stderr.flush()");
        lines.add("");
        lines.add("    def debug(self, message):");
        lines.add("        self._write(\"DEBUG\", message)");
        lines.add("");
        lines.add("    def info(self, message):");
        lines.add("        self._write(\"INFO\", message)");
        lines.add("");
        lines.add("    def warn(self, message):");
        lines.add("        self._write(\"WARN\", message)");
        lines.add("");
        lines.add("    def error(self, message):");
        lines.add("        self._write(\"ERROR\", message)");
        lines.add("");
        lines.add("log = __ScriptFlowLog()");
        lines.add("");
        lines.add("def __scriptflow_main(input):");
        lines.addAll(indent(normalizedSource));
        return String.join("\n", lines) + "\n";
    }

    private List<String> indent(String source) {
        String[] lines = source.split("\n", -1);
        List<String> indented = new ArrayList<>();
        for (String line : lines) {
            indented.add(line.isEmpty() ? "    " : "    " + line);
        }
        return indented;
    }

    private String readStream(InputStream stream) {
        try (InputStream inputStream = stream) {
            return new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to read Python process output", e);
        }
    }

    private String readErrorStream(InputStream stream, Consumer<LogEvent> logConsumer) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder output = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                LogEvent event = parseLogEvent(line);
                if (event != null) {
                    logConsumer.accept(event);
                    continue;
                }
                if (output.length() > 0) {
                    output.append('\n');
                }
                output.append(line);
            }
            return output.toString();
        } catch (IOException e) {
            throw new IllegalStateException("Failed to read Python process output", e);
        }
    }

    private LogEvent parseLogEvent(String line) {
        if (line == null || !line.startsWith(LOG_PREFIX)) {
            return null;
        }
        try {
            Map<String, Object> value = jsonCodec.readMap(line.substring(LOG_PREFIX.length()));
            Object level = value.get("level");
            Object message = value.get("message");
            return new LogEvent(resolveLevel(level), message == null ? "" : String.valueOf(message));
        } catch (Exception ignored) {
            return null;
        }
    }

    private ExecutionLogLevel resolveLevel(Object value) {
        if (value == null) {
            return ExecutionLogLevel.INFO;
        }
        try {
            return ExecutionLogLevel.valueOf(String.valueOf(value).trim().toUpperCase());
        } catch (IllegalArgumentException ignored) {
            return ExecutionLogLevel.INFO;
        }
    }

    private String extractErrorMessage(ProcessResult result) {
        String stderr = result.stderr() == null ? "" : result.stderr().trim();
        if (!stderr.isEmpty()) {
            return stderr;
        }
        String stdout = result.stdout() == null ? "" : result.stdout().trim();
        if (!stdout.isEmpty()) {
            return stdout;
        }
        return "Python 脚本执行失败";
    }

    private void deleteIfExists(Path path) {
        if (path == null) {
            return;
        }
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
        }
    }

    record ProcessResult(int exitCode, String stdout, String stderr, boolean timedOut) {
    }

    record LogEvent(ExecutionLogLevel level, String message) {
    }
}
