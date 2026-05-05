package org.team4u.actiondock.script;

import org.team4u.actiondock.application.ErrorDetailSupport;
import org.team4u.actiondock.application.MapValueConverter;
import org.team4u.actiondock.application.PythonRequirementsSupport;
import org.team4u.actiondock.application.ScriptInvocationService;
import org.team4u.actiondock.application.SharedStateApplicationService;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ErrorDetail;
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
import java.util.concurrent.Executor;
import java.util.concurrent.ForkJoinPool;
import java.util.function.BiFunction;
import java.util.function.Consumer;
import java.util.function.Function;

/**
 * Python 脚本引擎，通过子进程方式执行 Python 脚本。
 * <p>
 * 将用户脚本包装为标准化的 Python 入口函数，通过 stdin/stdout 传递 JSON 数据，
 * 并支持通过 stderr 的特殊前缀协议收集脚本日志与脚本互调请求。
 * <p>
 * 环境管理（虚拟环境创建、依赖安装等）委托给 {@link PythonEnvironmentManager}。
 *
 * @author jay.wu
 */
public class PythonScriptEngine implements ScriptEngine {
    private static final System.Logger log = System.getLogger(PythonScriptEngine.class.getName());
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
    private final Executor asyncExecutor;
    private final PythonEnvironmentManager environmentManager;

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
        this(jsonCodec, properties, pluginRuntimeService, scriptInvocationService, sharedStateApplicationService, null);
    }

    public PythonScriptEngine(JsonCodec jsonCodec,
                              AppProperties.Python properties,
                              PluginRuntimeService pluginRuntimeService,
                              ScriptInvocationService scriptInvocationService,
                              SharedStateApplicationService sharedStateApplicationService,
                              Executor asyncExecutor) {
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
        this.asyncExecutor = asyncExecutor == null ? ForkJoinPool.commonPool() : asyncExecutor;
        this.environmentManager = new PythonEnvironmentManager(jsonCodec, properties, asyncExecutor);
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
            PythonRequirementsSupport.parse(definition.getId(), definition.getPythonRequirements());
            scriptPath = writeScriptFile(definition.getSource(), false);
            ProcessSupport.ProcessResult result = runCommand(
                    buildValidationCommand(scriptPath),
                    null,
                    "{}",
                    null,
                    null,
                    properties.getTimeoutSeconds()
            );
            checkValidationResult(result);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to validate Python script", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Python validation interrupted", e);
        } finally {
            deleteIfExists(scriptPath);
        }
    }

    private List<String> buildValidationCommand(Path scriptPath) {
        return List.of(resolveExecutable(), "-c", VALIDATION_RUNNER, scriptPath.toAbsolutePath().toString());
    }

    private static void checkValidationResult(ProcessSupport.ProcessResult result) {
        if (result.timedOut()) {
            throw new IllegalStateException("Python 脚本校验超时");
        }
        if (result.exitCode() != 0) {
            throw new IllegalArgumentException(extractErrorMessage(result));
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
            ExecuteContext ctx = buildExecuteContext(definition, input, executionContext, scriptPath);
            ProcessSupport.ProcessResult result = runCommand(
                    ctx.command,
                    ctx.stdin,
                    ctx.configJson,
                    ctx.logConsumer,
                    ctx.bridge
            );
            return processExecuteResult(result, ctx.command);
        } catch (PythonExecutionException exception) {
            throw exception;
        } catch (IOException e) {
            throw new IllegalStateException("Failed to execute Python script", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Python execution interrupted", e);
        } finally {
            deleteIfExists(scriptPath);
        }
    }

    private ExecuteContext buildExecuteContext(ScriptDefinition definition, Map<String, Object> input,
                                                ScriptExecutionContext executionContext, Path scriptPath)
            throws IOException, InterruptedException {
        PythonRequirementsSupport.ParsedPythonRequirements parsedRequirements =
                PythonRequirementsSupport.parse(definition.getId(), definition.getPythonRequirements());
        PythonEnvironmentManager.PythonExecutable executable = environmentManager.resolveRuntimeExecutable(
                parsedRequirements, definition, executionContext, resolveExecutable());
        return new ExecuteContext(
                List.of(executable.path(), scriptPath.toAbsolutePath().toString()),
                jsonCodec.write(input == null ? Map.of() : input) + "\n",
                jsonCodec.write(executionContext == null ? Map.of() : executionContext.getConfig()),
                event -> {
                    if (executionContext != null) {
                        executionContext.log(event.level(), event.message());
                    }
                },
                new PythonBridge(definition, input == null ? Map.of() : input, executionContext)
        );
    }

    private Object processExecuteResult(ProcessSupport.ProcessResult result, List<String> command) {
        if (result.timedOut()) {
            throw new IllegalStateException("Python 脚本执行超时");
        }
        if (result.exitCode() != 0) {
            throw new PythonExecutionException(
                    extractErrorMessage(result),
                    buildErrorDetail("PYTHON_EXECUTION_FAILED", result, Map.of("command", command))
            );
        }
        return jsonCodec.readUntyped(result.stdout());
    }

    private record ExecuteContext(List<String> command, String stdin, String configJson,
                                   Consumer<ProcessSupport.LogEvent> logConsumer, PythonBridge bridge) {
    }

    private ProcessSupport.ProcessResult runCommand(List<String> command,
                                     String stdin,
                                     String configJson,
                                     Consumer<ProcessSupport.LogEvent> logConsumer,
                                     PythonBridge invocationBridge)
            throws IOException, InterruptedException {
        return runCommand(command, stdin, configJson, logConsumer, invocationBridge, properties.getTimeoutSeconds());
    }

    private ProcessSupport.ProcessResult runCommand(List<String> command,
                                     String stdin,
                                     String configJson,
                                     Consumer<ProcessSupport.LogEvent> logConsumer,
                                     PythonBridge invocationBridge,
                                     int timeoutSeconds)
            throws IOException, InterruptedException {
        ProcessBuilder processBuilder = new ProcessBuilder();
        processBuilder.command(command);
        processBuilder.environment().put("ACTIONDOCK_CONFIG_JSON", configJson == null ? "{}" : configJson);
        Process process = processBuilder.start();
        CompletableFuture<String> stdoutFuture = CompletableFuture.supplyAsync(() -> ProcessSupport.readStream(process.getInputStream()), asyncExecutor);
        CompletableFuture<String> stderrFuture = CompletableFuture.supplyAsync(() ->
                readErrorStream(
                        process.getErrorStream(),
                        logConsumer == null ? event -> { } : logConsumer,
                        process.getOutputStream(),
                        invocationBridge
                ), asyncExecutor);

        return ProcessSupport.runProcessToCompletion(process, stdin, stdoutFuture, stderrFuture, timeoutSeconds, properties.getTimeoutSeconds());
    }

    private String resolveExecutable() {
        if (properties.getExecutable() == null || properties.getExecutable().isBlank()) {
            return "python3";
        }
        return properties.getExecutable().trim();
    }

    private static Path writeScriptFile(String source, boolean executable) throws IOException {
        Path scriptPath = Files.createTempFile("actiondock-python-", ".py");
        String content = executable ? buildExecutableScript(source) : buildWrappedSource(source);
        Files.writeString(scriptPath, content, StandardCharsets.UTF_8);
        return scriptPath;
    }

    private static String buildExecutableScript(String source) {
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

    private static String buildWrappedSource(String source) {
        String normalizedSource = source == null ? "" : source.replace("\r\n", "\n");
        if (normalizedSource.isBlank()) {
            normalizedSource = "return {}";
        }
        String indentedSource = String.join("\n", indent(normalizedSource));
        return PYTHON_WRAPPER_TEMPLATE.replace("{{ user_script }}", indentedSource);
    }

    private static List<String> indent(String source) {
        String[] lines = source.split("\n", -1);
        List<String> indented = new ArrayList<>();
        for (String line : lines) {
            indented.add(line.isEmpty() ? "    " : "    " + line);
        }
        return indented;
    }

    private String readErrorStream(InputStream stream,
                                   Consumer<ProcessSupport.LogEvent> logConsumer,
                                   OutputStream stdinStream,
                                   PythonBridge bridge) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder output = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                ProcessSupport.LogEvent event = parseLogEvent(line);
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
        handleBridgeMessage(payload, stdinStream, bridge,
                "Python 脚本互调桥接未初始化",
                this::parseInvocationRequest, PythonBridge::respondInvocation);
    }

    private void handleState(String payload,
                             OutputStream stdinStream,
                             PythonBridge bridge) {
        handleBridgeMessage(payload, stdinStream, bridge,
                "Python 状态桥接未初始化",
                this::parseStateRequest, PythonBridge::respondState);
    }

    private void handlePlugin(String payload,
                              OutputStream stdinStream,
                              PythonBridge bridge) {
        handleBridgeMessage(payload, stdinStream, bridge,
                "Python 插件桥接未初始化",
                this::parsePluginRequest, PythonBridge::respondPlugin);
    }

    private <R> void handleBridgeMessage(String payload,
                                          OutputStream stdinStream,
                                          PythonBridge bridge,
                                          String errorMessage,
                                          Function<String, R> parser,
                                          BiFunction<PythonBridge, R, String> responder) {
        if (bridge == null) {
            throw new IllegalStateException(errorMessage);
        }
        R request = parser.apply(payload);
        String response = responder.apply(bridge, request);
        try {
            stdinStream.write((response + "\n").getBytes(StandardCharsets.UTF_8));
            stdinStream.flush();
        } catch (IOException e) {
            throw new IllegalStateException("Failed to write Python bridge response", e);
        }
    }

    private PythonInvocationRequest parseInvocationRequest(String payload) {
        Map<String, Object> value = jsonCodec.readMap(payload);
        return new PythonInvocationRequest(stringField(value, "scriptId"), mapField(value, "args"));
    }

    private PythonStateRequest parseStateRequest(String payload) {
        Map<String, Object> value = jsonCodec.readMap(payload);
        return new PythonStateRequest(
                stringField(value, "operation"),
                stringField(value, "namespace"),
                stringField(value, "key"),
                value.get("expectedVersion") instanceof Number number ? number.longValue() : null,
                value.get("value"),
                mapField(value, "options")
        );
    }

    private PythonPluginRequest parsePluginRequest(String payload) {
        Map<String, Object> value = jsonCodec.readMap(payload);
        return new PythonPluginRequest(stringField(value, "pluginId"), stringField(value, "action"), mapField(value, "args"));
    }

    private static String stringField(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v == null ? null : String.valueOf(v);
    }

    private static Map<String, Object> mapField(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v instanceof Map<?, ?> m ? MapValueConverter.toResultMap(m) : Map.of();
    }

    private ProcessSupport.LogEvent parseLogEvent(String line) {
        return ProcessSupport.parseLogEvent(line, PythonEnvironmentManager.LOG_PREFIX, jsonCodec);
    }

    private static String extractErrorMessage(ProcessSupport.ProcessResult result) {
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

    private static String summarizePythonError(String stderr) {
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

    private static void deleteIfExists(Path path) {
        if (path == null) {
            return;
        }
        try {
            Files.deleteIfExists(path);
        } catch (IOException exception) {
            log.log(System.Logger.Level.DEBUG, "删除临时脚本文件失败: {0}", exception.getMessage());
        }
    }

    private static ErrorDetail buildErrorDetail(String code, ProcessSupport.ProcessResult result, Map<String, Object> details) {
        return ProcessSupport.buildErrorDetail(code, result, details);
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

        /**
         * 构建统一的 JSON 响应。
         * <p>
         * 使用 {@link LinkedHashMap} 以支持 value 为 null 的场景（如 delete 操作）。
         *
         * @param ok    操作是否成功
         * @param data  成功时为结果数据，失败时忽略
         * @param error 失败时的错误摘要，成功时忽略
         * @return JSON 格式的响应字符串
         */
        private String writeResponse(boolean ok, Object data, String error) {
            Map<String, Object> response = new LinkedHashMap<>();
            response.put("ok", ok);
            if (ok) {
                response.put("result", data);
            } else {
                response.put("error", error);
            }
            return jsonCodec.write(response);
        }

        private String respondInvocation(PythonInvocationRequest request) {
            return respond(() -> scriptInvocationService.invokePublished(
                    request.scriptId(), definition, executionContext, request.args()));
        }

        private String respondPlugin(PythonPluginRequest request) {
            return respond(() -> pluginRuntimeService.invoke(
                    request.pluginId(), request.action(), definition, executionContext, input, request.args()));
        }

        private String respondState(PythonStateRequest request) {
            return respond(() -> switch (request.operation()) {
                case "get" -> stateBridge.get(request.namespace(), request.key());
                case "put" -> stateBridge.put(request.namespace(), request.key(), request.value(), request.options());
                case "cas" -> stateBridge.cas(request.namespace(), request.key(), request.expectedVersion(), request.value(), request.options());
                case "delete" -> {
                    stateBridge.delete(request.namespace(), request.key());
                    yield null;
                }
                case "list" -> stateBridge.list(request.namespace());
                default -> throw new IllegalArgumentException("不支持的 state 操作: " + request.operation());
            });
        }

        private String respond(java.util.function.Supplier<Object> action) {
            try {
                return writeResponse(true, action.get(), null);
            } catch (Exception exception) {
                return writeResponse(false, null, ErrorDetailSupport.summarize(exception));
            }
        }
    }
}
