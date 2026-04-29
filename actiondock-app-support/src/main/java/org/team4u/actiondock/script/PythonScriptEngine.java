package org.team4u.actiondock.script;

import org.team4u.actiondock.application.ErrorDetailSupport;
import org.team4u.actiondock.application.ScriptInvocationService;
import org.team4u.actiondock.application.SharedStateApplicationService;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ExecutionLogLevel;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.plugin.PluginRuntimeService;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
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
 * 并支持通过 stderr 的特殊前缀协议收集脚本日志与脚本互调请求。
 *
 * @author jay.wu
 */
public class PythonScriptEngine implements ScriptEngine {
    private static final String LOG_PREFIX = "__ACTIONDOCK_LOG__";
    private static final String INVOKE_PREFIX = "__ACTIONDOCK_INVOKE__";
    private static final String PLUGIN_PREFIX = "__ACTIONDOCK_PLUGIN__";
    private static final String STATE_PREFIX = "__ACTIONDOCK_STATE__";
    private static final String VALIDATION_RUNNER = """
            import py_compile
            import sys

            py_compile.compile(sys.argv[1], doraise=True)
            """;

    private final JsonCodec jsonCodec;
    private final AppProperties.Python properties;
    private final PluginRuntimeService pluginRuntimeService;
    private final ScriptInvocationService scriptInvocationService;
    private final SharedStateApplicationService sharedStateApplicationService;

    public PythonScriptEngine(JsonCodec jsonCodec, AppProperties.Python properties) {
        this(
                jsonCodec,
                properties,
                PluginRuntimeService.disabled(),
                ScriptInvocationService.disabled(),
                SharedStateApplicationService.disabled()
        );
    }

    public PythonScriptEngine(JsonCodec jsonCodec,
                              AppProperties.Python properties,
                              ScriptInvocationService scriptInvocationService) {
        this(
                jsonCodec,
                properties,
                PluginRuntimeService.disabled(),
                scriptInvocationService,
                SharedStateApplicationService.disabled()
        );
    }

    public PythonScriptEngine(JsonCodec jsonCodec,
                              AppProperties.Python properties,
                              ScriptInvocationService scriptInvocationService,
                              SharedStateApplicationService sharedStateApplicationService) {
        this(jsonCodec, properties, PluginRuntimeService.disabled(), scriptInvocationService, sharedStateApplicationService);
    }

    public PythonScriptEngine(JsonCodec jsonCodec,
                              AppProperties.Python properties,
                              PluginRuntimeService pluginRuntimeService,
                              ScriptInvocationService scriptInvocationService,
                              SharedStateApplicationService sharedStateApplicationService) {
        this.jsonCodec = Objects.requireNonNull(jsonCodec);
        this.properties = Objects.requireNonNull(properties);
        this.pluginRuntimeService = pluginRuntimeService == null
                ? PluginRuntimeService.disabled()
                : pluginRuntimeService;
        this.scriptInvocationService = scriptInvocationService == null
                ? ScriptInvocationService.disabled()
                : scriptInvocationService;
        this.sharedStateApplicationService = sharedStateApplicationService == null
                ? SharedStateApplicationService.disabled()
                : sharedStateApplicationService;
    }

    /**
     * 校验 Python 脚本语法是否正确。
     * <p>
     * 将脚本源码写入临时文件，使用 Python 内置的 {@code py_compile} 模块进行语法校验。
     * 校验完成后自动删除临时文件。
     *
     * @param definition 脚本定义，包含待校验的源码
     * @throws IllegalArgumentException 如果脚本语法错误
     * @throws IllegalStateException    如果校验超时或 IO 失败
     */
    @Override
    public void validate(ScriptDefinition definition) {
        Path scriptPath = null;
        try {
            scriptPath = writeScriptFile(definition.getSource(), false);
            ProcessResult result = runCommand(
                    List.of(resolveExecutable(), "-c", VALIDATION_RUNNER, scriptPath.toAbsolutePath().toString()),
                    null,
                    "{}",
                    null,
                    null
            );
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

    /**
     * 执行 Python 脚本。
     * <p>
     * 将脚本源码包装为标准化的 Python 入口函数，写入临时文件后以子进程方式执行。
     * 通过 stdin 传入脚本输入（JSON），通过环境变量传入脚本配置。
     * stderr 中的特殊前缀协议用于收集脚本日志、脚本互调和共享状态请求，stdout 输出作为执行结果。
     *
     * @param definition       脚本定义，包含源码和元信息
     * @param input            脚本输入数据，通过 stdin 以 JSON 格式传入
     * @param executionContext 脚本执行上下文，包含配置和日志收集器
     * @return 脚本执行的返回值（从 stdout 解析的 JSON 结果）
     * @throws IllegalStateException 如果执行超时、进程异常或 IO 失败
     */
    @Override
    public Object execute(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext) {
        Path scriptPath = null;
        try {
            scriptPath = writeScriptFile(definition.getSource(), true);
            ProcessResult result = runCommand(
                    List.of(resolveExecutable(), scriptPath.toAbsolutePath().toString()),
                    jsonCodec.write(input == null ? Map.of() : input) + "\n",
                    jsonCodec.write(executionContext == null ? Map.of() : executionContext.getConfig()),
                    event -> {
                        if (executionContext != null) {
                            executionContext.log(event.level(), event.message());
                        }
                    },
                    new PythonBridge(definition, input == null ? Map.of() : input, executionContext)
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
                                     Consumer<LogEvent> logConsumer,
                                     PythonBridge invocationBridge)
            throws IOException, InterruptedException {
        ProcessBuilder processBuilder = new ProcessBuilder();
        processBuilder.command(command);
        processBuilder.environment().put("ACTIONDOCK_CONFIG_JSON", configJson == null ? "{}" : configJson);
        Process process = processBuilder.start();
        CompletableFuture<String> stdoutFuture = CompletableFuture.supplyAsync(() -> readStream(process.getInputStream()));
        CompletableFuture<String> stderrFuture = CompletableFuture.supplyAsync(() ->
                readErrorStream(
                        process.getErrorStream(),
                        logConsumer == null ? event -> { } : logConsumer,
                        process.getOutputStream(),
                        invocationBridge
                ));

        try (OutputStream stdinStream = process.getOutputStream()) {
            if (stdin != null) {
                stdinStream.write(stdin.getBytes(StandardCharsets.UTF_8));
                stdinStream.flush();
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
    }

    private String resolveExecutable() {
        if (properties.getExecutable() == null || properties.getExecutable().isBlank()) {
            return "python3";
        }
        return properties.getExecutable().trim();
    }

    private Path writeScriptFile(String source, boolean executable) throws IOException {
        Path scriptPath = Files.createTempFile("actiondock-python-", ".py");
        String content = executable ? buildExecutableScript(source) : buildWrappedSource(source);
        Files.writeString(scriptPath, content, StandardCharsets.UTF_8);
        return scriptPath;
    }

    private String buildExecutableScript(String source) {
        return buildWrappedSource(source) + """

                if __name__ == "__main__":
                    payload_text = sys.stdin.readline()
                    input = {} if not payload_text.strip() else json.loads(payload_text)
                    config_text = os.environ.get("ACTIONDOCK_CONFIG_JSON", "")
                    config = {} if not config_text.strip() else json.loads(config_text)
                    result = __actiondock_main(input)
                    json.dump(result, sys.stdout, ensure_ascii=False)
                """;
    }

    private static final String PYTHON_WRAPPER_TEMPLATE = loadPythonWrapperTemplate();

    private static String loadPythonWrapperTemplate() {
        try (InputStream is = PythonScriptEngine.class.getClassLoader().getResourceAsStream("python-wrapper.py")) {
            if (is == null) {
                throw new IllegalStateException("python-wrapper.py template not found");
            }
            return new String(is.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to load python-wrapper.py template", e);
        }
    }

    private String buildWrappedSource(String source) {
        String normalizedSource = source == null ? "" : source.replace("\r\n", "\n");
        if (normalizedSource.isBlank()) {
            normalizedSource = "return {}";
        }
        String indentedSource = String.join("\n", indent(normalizedSource));
        return PYTHON_WRAPPER_TEMPLATE.replace("{{ user_script }}", indentedSource);
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

    private String readErrorStream(InputStream stream,
                                   Consumer<LogEvent> logConsumer,
                                   OutputStream stdinStream,
                                   PythonBridge bridge) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder output = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                LogEvent event = parseLogEvent(line);
                if (event != null) {
                    logConsumer.accept(event);
                    continue;
                }
                if (line.startsWith(INVOKE_PREFIX)) {
                    handleInvocation(line.substring(INVOKE_PREFIX.length()), stdinStream, bridge);
                    continue;
                }
                if (line.startsWith(PLUGIN_PREFIX)) {
                    handlePlugin(line.substring(PLUGIN_PREFIX.length()), stdinStream, bridge);
                    continue;
                }
                if (line.startsWith(STATE_PREFIX)) {
                    handleState(line.substring(STATE_PREFIX.length()), stdinStream, bridge);
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

    private void handleInvocation(String payload,
                                  OutputStream stdinStream,
                                  PythonBridge bridge) {
        if (bridge == null) {
            throw new IllegalStateException("Python 脚本互调桥接未初始化");
        }
        PythonInvocationRequest request = parseInvocationRequest(payload);
        String response = bridge.respondInvocation(request);
        try {
            stdinStream.write((response + "\n").getBytes(StandardCharsets.UTF_8));
            stdinStream.flush();
        } catch (IOException e) {
            throw new IllegalStateException("Failed to write Python invocation response", e);
        }
    }

    private void handleState(String payload,
                             OutputStream stdinStream,
                             PythonBridge bridge) {
        if (bridge == null) {
            throw new IllegalStateException("Python 状态桥接未初始化");
        }
        PythonStateRequest request = parseStateRequest(payload);
        String response = bridge.respondState(request);
        try {
            stdinStream.write((response + "\n").getBytes(StandardCharsets.UTF_8));
            stdinStream.flush();
        } catch (IOException e) {
            throw new IllegalStateException("Failed to write Python state response", e);
        }
    }

    private void handlePlugin(String payload,
                              OutputStream stdinStream,
                              PythonBridge bridge) {
        if (bridge == null) {
            throw new IllegalStateException("Python 插件桥接未初始化");
        }
        PythonPluginRequest request = parsePluginRequest(payload);
        String response = bridge.respondPlugin(request);
        try {
            stdinStream.write((response + "\n").getBytes(StandardCharsets.UTF_8));
            stdinStream.flush();
        } catch (IOException e) {
            throw new IllegalStateException("Failed to write Python plugin response", e);
        }
    }

    private PythonInvocationRequest parseInvocationRequest(String payload) {
        Map<String, Object> value = jsonCodec.readMap(payload);
        Object scriptId = value.get("scriptId");
        Object args = value.get("args");
        return new PythonInvocationRequest(
                scriptId == null ? null : String.valueOf(scriptId),
                args instanceof Map<?, ?> map ? normalizeMap(map) : Map.of()
        );
    }

    private PythonStateRequest parseStateRequest(String payload) {
        Map<String, Object> value = jsonCodec.readMap(payload);
        Object expectedVersion = value.get("expectedVersion");
        Object options = value.get("options");
        return new PythonStateRequest(
                stringValue(value.get("operation")),
                stringValue(value.get("namespace")),
                stringValue(value.get("key")),
                expectedVersion instanceof Number number ? number.longValue() : null,
                value.get("value"),
                options instanceof Map<?, ?> map ? normalizeMap(map) : Map.of()
        );
    }

    private PythonPluginRequest parsePluginRequest(String payload) {
        Map<String, Object> value = jsonCodec.readMap(payload);
        Object args = value.get("args");
        return new PythonPluginRequest(
                stringValue(value.get("pluginId")),
                stringValue(value.get("action")),
                args instanceof Map<?, ?> map ? normalizeMap(map) : Map.of()
        );
    }

    private Map<String, Object> normalizeMap(Map<?, ?> value) {
        Map<String, Object> normalized = new LinkedHashMap<>();
        value.forEach((key, item) -> normalized.put(String.valueOf(key), item));
        return normalized;
    }

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
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
            return summarizePythonError(stderr);
        }
        String stdout = result.stdout() == null ? "" : result.stdout().trim();
        if (!stdout.isEmpty()) {
            return stdout;
        }
        return "Python 脚本执行失败";
    }

    private String summarizePythonError(String stderr) {
        String[] lines = stderr.split("\\R");
        for (int index = lines.length - 1; index >= 0; index -= 1) {
            String line = lines[index].trim();
            if (line.isEmpty()) {
                continue;
            }
            int separator = line.indexOf(": ");
            if (separator > 0 && separator < line.length() - 2) {
                return line.substring(separator + 2).trim();
            }
            return line;
        }
        return stderr;
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

    record PythonInvocationRequest(String scriptId, Map<String, Object> args) {
    }

    record PythonPluginRequest(String pluginId, String action, Map<String, Object> args) {
    }

    record PythonStateRequest(String operation,
                              String namespace,
                              String key,
                              Long expectedVersion,
                              Object value,
                              Map<String, Object> options) {
    }

    private final class PythonBridge {
        private final ScriptDefinition definition;
        private final Map<String, Object> input;
        private final ScriptExecutionContext executionContext;
        private final ScriptStateBridge stateBridge;

        private PythonBridge(ScriptDefinition definition,
                             Map<String, Object> input,
                             ScriptExecutionContext executionContext) {
            this.definition = definition;
            this.input = input == null ? Map.of() : new LinkedHashMap<>(input);
            this.executionContext = executionContext;
            this.stateBridge = new ScriptStateBridge(sharedStateApplicationService, definition, executionContext);
        }

        private String respondInvocation(PythonInvocationRequest request) {
            try {
                Object result = scriptInvocationService.invokePublished(
                        request.scriptId(),
                        definition,
                        executionContext,
                        request.args()
                );
                return jsonCodec.write(Map.of(
                        "ok", true,
                        "result", result
                ));
            } catch (Exception exception) {
                return jsonCodec.write(Map.of(
                        "ok", false,
                        "error", ErrorDetailSupport.summarize(exception)
                ));
            }
        }

        private String respondPlugin(PythonPluginRequest request) {
            try {
                Object result = pluginRuntimeService.invoke(
                        request.pluginId(),
                        request.action(),
                        definition,
                        executionContext,
                        input,
                        request.args()
                );
                return jsonCodec.write(Map.of(
                        "ok", true,
                        "result", result
                ));
            } catch (Exception exception) {
                return jsonCodec.write(Map.of(
                        "ok", false,
                        "error", ErrorDetailSupport.summarize(exception)
                ));
            }
        }

        private String respondState(PythonStateRequest request) {
            try {
                Object result = switch (request.operation()) {
                    case "get" -> stateBridge.get(request.namespace(), request.key());
                    case "put" -> stateBridge.put(request.namespace(), request.key(), request.value(), request.options());
                    case "cas" -> stateBridge.cas(request.namespace(), request.key(), request.expectedVersion(), request.value(), request.options());
                    case "delete" -> {
                        stateBridge.delete(request.namespace(), request.key());
                        yield null;
                    }
                    case "list" -> stateBridge.list(request.namespace());
                    default -> throw new IllegalArgumentException("不支持的 state 操作: " + request.operation());
                };
                Map<String, Object> values = new LinkedHashMap<>();
                values.put("ok", true);
                values.put("result", result);
                return jsonCodec.write(values);
            } catch (Exception exception) {
                return jsonCodec.write(Map.of(
                        "ok", false,
                        "error", ErrorDetailSupport.summarize(exception)
                ));
            }
        }
    }
}
