package org.team4u.actiondock.script;

import org.team4u.actiondock.common.NormalizeUtils;

import org.team4u.actiondock.application.MapValueConverter;
import org.team4u.actiondock.application.PythonRequirementsSupport;
import org.team4u.actiondock.application.ScriptInvocationService;
import org.team4u.actiondock.application.SharedStateApplicationService;
import org.team4u.actiondock.config.AppProperties;
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
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
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
 * <p>
 * 推荐通过 {@link #builder(JsonCodec)} 构建，也可使用遗留的构造函数快捷方式。
 *
 * @author jay.wu
 */
public class PythonScriptEngine implements ScriptEngine {
    private static final System.Logger log = System.getLogger(PythonScriptEngine.class.getName());
    private static final String DEFAULT_PYTHON_EXECUTABLE = "python3";
    private static final String INVOKE_PREFIX = "__ACTIONDOCK_INVOKE__";
    private static final String PLUGIN_PREFIX = "__ACTIONDOCK_PLUGIN__";
    private static final String STATE_PREFIX = "__ACTIONDOCK_STATE__";
    private static final String SHELL_PREFIX = "__ACTIONDOCK_SHELL__";
    private static final String VALIDATION_RUNNER = """
            import py_compile
            import sys

            py_compile.compile(sys.argv[1], doraise=True)
            """;

    private final JsonCodec jsonCodec;
    private final AppProperties appProperties;
    private final AppProperties.Python properties;
    private final PluginRuntimeService pluginRuntimeService;
    private final ScriptInvocationService scriptInvocationService;
    private final SharedStateApplicationService sharedStateApplicationService;
    private final Executor asyncExecutor;
    private final PythonEnvironmentManager environmentManager;
    private volatile String detectedExecutable = null;

    /**
     * 使用 JSON 编解码器和 Python 配置创建引擎（所有可选依赖均为禁用状态）。
     *
     * @param jsonCodec  JSON 编解码器，不能为 null
     * @param properties Python 脚本引擎配置，为 null 时使用默认值
     */
    public PythonScriptEngine(JsonCodec jsonCodec, AppProperties.Python properties) {
        this(builder(jsonCodec).pythonProperties(properties));
    }

    /**
     * 使用 JSON 编解码器、Python 配置和脚本互调服务创建引擎。
     *
     * @param jsonCodec                JSON 编解码器，不能为 null
     * @param properties               Python 脚本引擎配置，为 null 时使用默认值
     * @param scriptInvocationService  脚本互调服务，为 null 时使用禁用实现
     */
    public PythonScriptEngine(JsonCodec jsonCodec,
                              AppProperties.Python properties,
                              ScriptInvocationService scriptInvocationService) {
        this(builder(jsonCodec).pythonProperties(properties).scriptInvocationService(scriptInvocationService));
    }

    /**
     * 使用 JSON 编解码器、Python 配置、脚本互调和共享状态服务创建引擎。
     *
     * @param jsonCodec                    JSON 编解码器，不能为 null
     * @param properties                   Python 脚本引擎配置，为 null 时使用默认值
     * @param scriptInvocationService      脚本互调服务，为 null 时使用禁用实现
     * @param sharedStateApplicationService 共享状态服务，为 null 时使用禁用实现
     */
    public PythonScriptEngine(JsonCodec jsonCodec,
                              AppProperties.Python properties,
                              ScriptInvocationService scriptInvocationService,
                              SharedStateApplicationService sharedStateApplicationService) {
        this(builder(jsonCodec).pythonProperties(properties).scriptInvocationService(scriptInvocationService)
                .sharedStateApplicationService(sharedStateApplicationService));
    }

    /**
     * 使用 JSON 编解码器、Python 配置和全部可选依赖创建引擎。
     *
     * @param jsonCodec                    JSON 编解码器，不能为 null
     * @param properties                   Python 脚本引擎配置，为 null 时使用默认值
     * @param pluginRuntimeService         插件运行时服务，为 null 时使用禁用实现
     * @param scriptInvocationService      脚本互调服务，为 null 时使用禁用实现
     * @param sharedStateApplicationService 共享状态服务，为 null 时使用禁用实现
     */
    public PythonScriptEngine(JsonCodec jsonCodec,
                              AppProperties.Python properties,
                              PluginRuntimeService pluginRuntimeService,
                              ScriptInvocationService scriptInvocationService,
                              SharedStateApplicationService sharedStateApplicationService) {
        this(builder(jsonCodec).pythonProperties(properties).pluginRuntimeService(pluginRuntimeService)
                .scriptInvocationService(scriptInvocationService).sharedStateApplicationService(sharedStateApplicationService));
    }

    /**
     * 使用 JSON 编解码器、Python 配置和全部可选依赖创建引擎（含异步执行器）。
     *
     * @param jsonCodec                    JSON 编解码器，不能为 null
     * @param properties                   Python 脚本引擎配置，为 null 时使用默认值
     * @param pluginRuntimeService         插件运行时服务，为 null 时使用禁用实现
     * @param scriptInvocationService      脚本互调服务，为 null 时使用禁用实现
     * @param sharedStateApplicationService 共享状态服务，为 null 时使用禁用实现
     * @param asyncExecutor                异步执行器，为 null 时使用公共 ForkJoinPool
     */
    public PythonScriptEngine(JsonCodec jsonCodec,
                              AppProperties.Python properties,
                              PluginRuntimeService pluginRuntimeService,
                              ScriptInvocationService scriptInvocationService,
                              SharedStateApplicationService sharedStateApplicationService,
                              Executor asyncExecutor) {
        this(builder(jsonCodec).pythonProperties(properties).pluginRuntimeService(pluginRuntimeService)
                .scriptInvocationService(scriptInvocationService)
                .sharedStateApplicationService(sharedStateApplicationService).asyncExecutor(asyncExecutor));
    }

    /**
     * 使用 JSON 编解码器、全局应用配置和全部可选依赖创建引擎。
     * <p>
     * Python 配置将从 {@code appProperties.getExecution().getPython()} 获取。
     *
     * @param jsonCodec                    JSON 编解码器，不能为 null
     * @param appProperties                全局应用配置，为 null 时使用默认值
     * @param pluginRuntimeService         插件运行时服务，为 null 时使用禁用实现
     * @param scriptInvocationService      脚本互调服务，为 null 时使用禁用实现
     * @param sharedStateApplicationService 共享状态服务，为 null 时使用禁用实现
     * @param asyncExecutor                异步执行器，为 null 时使用公共 ForkJoinPool
     */
    public PythonScriptEngine(JsonCodec jsonCodec,
                              AppProperties appProperties,
                              PluginRuntimeService pluginRuntimeService,
                              ScriptInvocationService scriptInvocationService,
                              SharedStateApplicationService sharedStateApplicationService,
                              Executor asyncExecutor) {
        this(builder(jsonCodec).appProperties(appProperties).pluginRuntimeService(pluginRuntimeService)
                .scriptInvocationService(scriptInvocationService)
                .sharedStateApplicationService(sharedStateApplicationService).asyncExecutor(asyncExecutor));
    }

    /**
     * 使用 Builder 配置构建引擎。
     */
    private PythonScriptEngine(Builder b) {
        this.jsonCodec = Objects.requireNonNull(b.jsonCodec);
        this.appProperties = b.appProperties == null ? new AppProperties() : b.appProperties;
        this.properties = b.pythonProperties == null ? this.appProperties.getExecution().getPython() : b.pythonProperties;
        this.pluginRuntimeService = b.pluginRuntimeService == null
                ? PluginRuntimeService.disabled() : b.pluginRuntimeService;
        this.scriptInvocationService = b.scriptInvocationService == null
                ? ScriptInvocationService.disabled() : b.scriptInvocationService;
        this.sharedStateApplicationService = b.sharedStateApplicationService == null
                ? SharedStateApplicationService.disabled() : b.sharedStateApplicationService;
        this.asyncExecutor = b.asyncExecutor == null ? ForkJoinPool.commonPool() : b.asyncExecutor;
        this.environmentManager = new PythonEnvironmentManager(jsonCodec, properties, asyncExecutor);
    }

    /**
     * 创建构建器，用于灵活配置引擎的所有依赖项。
     * <p>
     * 示例：{@code PythonScriptEngine.builder(jsonCodec).appProperties(props).pluginRuntimeService(svc).build()}
     *
     * @param jsonCodec JSON 编解码器（必填）
     * @return 构建器实例
     */
    public static Builder builder(JsonCodec jsonCodec) {
        return new Builder(jsonCodec);
    }

    /**
     * Python 脚本引擎的构建器，支持链式配置所有可选依赖。
     * <p>
     * JSON 编解码器为必填项，其余配置项均为可选，未设置的依赖将自动使用禁用实现或默认值。
     */
    public static class Builder {
        private final JsonCodec jsonCodec;
        private AppProperties appProperties;
        private AppProperties.Python pythonProperties;
        private PluginRuntimeService pluginRuntimeService;
        private ScriptInvocationService scriptInvocationService;
        private SharedStateApplicationService sharedStateApplicationService;
        private Executor asyncExecutor;

        private Builder(JsonCodec jsonCodec) {
            this.jsonCodec = jsonCodec;
        }

        /** 设置全局应用配置。 */
        public Builder appProperties(AppProperties appProperties) {
            this.appProperties = appProperties;
            return this;
        }

        /** 设置 Python 脚本引擎专属配置。 */
        public Builder pythonProperties(AppProperties.Python pythonProperties) {
            this.pythonProperties = pythonProperties;
            return this;
        }

        /** 设置插件运行时服务。 */
        public Builder pluginRuntimeService(PluginRuntimeService pluginRuntimeService) {
            this.pluginRuntimeService = pluginRuntimeService;
            return this;
        }

        /** 设置脚本互调服务。 */
        public Builder scriptInvocationService(ScriptInvocationService scriptInvocationService) {
            this.scriptInvocationService = scriptInvocationService;
            return this;
        }

        /** 设置共享状态应用服务。 */
        public Builder sharedStateApplicationService(SharedStateApplicationService sharedStateApplicationService) {
            this.sharedStateApplicationService = sharedStateApplicationService;
            return this;
        }

        /** 设置异步执行器。 */
        public Builder asyncExecutor(Executor asyncExecutor) {
            this.asyncExecutor = asyncExecutor;
            return this;
        }

        /** 构建 Python 脚本引擎实例。 */
        public PythonScriptEngine build() {
            return new PythonScriptEngine(this);
        }
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
                    List.of(resolveExecutable(), "-c", VALIDATION_RUNNER, scriptPath.toAbsolutePath().toString()),
                    null,
                    "{}",
                    null,
                    null,
                    properties.getTimeoutSeconds()
            );
            if (result.timedOut()) {
                throw new IllegalStateException("Python 脚本校验超时");
            }
            if (result.exitCode() != 0) {
                throw new IllegalArgumentException(PythonErrorParser.extractErrorMessage(result));
            }
        } catch (IOException e) {
            throw new IllegalStateException("校验 Python 脚本失败", e);
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
            ExecuteContext ctx = buildExecuteContext(definition, input, executionContext, scriptPath);
            ProcessSupport.ProcessResult result = runCommand(
                    ctx.command,
                    ctx.stdin,
                    ctx.configJson,
                    ctx.logConsumer,
                    ctx.bridge
            );
            return processExecuteResult(result, ctx.command);
        } catch (IOException e) {
            throw new IllegalStateException("执行 Python 脚本失败", e);
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
                new PythonBridge(jsonCodec, scriptInvocationService, pluginRuntimeService, sharedStateApplicationService, appProperties, definition, input == null ? Map.of() : input, executionContext)
        );
    }

    private Object processExecuteResult(ProcessSupport.ProcessResult result, List<String> command) {
        if (result.timedOut()) {
            throw new IllegalStateException("Python 脚本执行超时");
        }
        if (result.exitCode() != 0) {
            throw new PythonExecutionException(
                    PythonErrorParser.extractErrorMessage(result),
                    ProcessSupport.buildErrorDetail("PYTHON_EXECUTION_FAILED", result, Map.of("command", command))
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
        processBuilder.environment().put("ACTIONDOCK_CONTEXT_JSON", invocationBridge == null ? "{}" : invocationBridge.contextJson());
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
        String configured = properties.getExecutable();
        if (NormalizeUtils.isBlank(configured)) {
            configured = DEFAULT_PYTHON_EXECUTABLE;
        } else {
            configured = configured.trim();
        }

        String cached = this.detectedExecutable;
        if (cached != null) {
            return cached;
        }

        synchronized (this) {
            cached = this.detectedExecutable;
            if (cached != null) {
                return cached;
            }
            this.detectedExecutable = detectPythonExecutable(configured);
            return this.detectedExecutable;
        }
    }

    private String detectPythonExecutable(String configured) {
        if (isValidPython3(configured)) {
            return configured;
        }

        List<String> candidates = Arrays.asList(DEFAULT_PYTHON_EXECUTABLE, "python", "py");
        for (String candidate : candidates) {
            if (!candidate.equals(configured) && isValidPython3(candidate)) {
                log.log(System.Logger.Level.INFO, "自动检测到 Python 可执行文件: {0}（回退自配置项: {1}）", candidate, configured);
                return candidate;
            }
        }

        return configured;
    }

    private boolean isValidPython3(String cmd) {
        if (NormalizeUtils.isBlank(cmd)) {
            return false;
        }
        try {
            Process process = new ProcessBuilder(cmd.trim(), "-c", "import sys; print(sys.version_info.major)")
                    .redirectErrorStream(true)
                    .start();
            if (!process.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)) {
                process.destroyForcibly();
                return false;
            }
            if (process.exitValue() == 0) {
                try (InputStream is = process.getInputStream()) {
                    String output = new String(is.readAllBytes(), StandardCharsets.UTF_8).trim();
                    return "3".equals(output);
                }
            }
        } catch (Exception ignored) {
        }
        return false;
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
                    context_text = os.environ.get("ACTIONDOCK_CONTEXT_JSON", "")
                    context = {} if not context_text.strip() else json.loads(context_text)
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
            throw new IllegalStateException("加载 python-wrapper.py 模板失败", e);
        }
    }

    private static String buildWrappedSource(String source) {
        String normalizedSource = source == null ? "" : source.replace("\r\n", "\n");
        if (normalizedSource.isBlank()) {
            normalizedSource = "return {}";
        }
        String indentedSource = Arrays.stream(normalizedSource.split("\n", -1))
                .map(line -> line.isEmpty() ? "    " : "    " + line)
                .collect(Collectors.joining("\n"));
        return PYTHON_WRAPPER_TEMPLATE.replace("{{ user_script }}", indentedSource);
    }

    private String readErrorStream(InputStream stream,
                                   Consumer<ProcessSupport.LogEvent> logConsumer,
                                   OutputStream stdinStream,
                                   PythonBridge bridge) {
        return ProcessSupport.readStreamLineByLine(stream, line -> {
            ProcessSupport.LogEvent event = parseLogEvent(line);
            if (event != null) {
                logConsumer.accept(event);
                return true;
            }
            if (line.startsWith(INVOKE_PREFIX)) {
                handleInvocation(line.substring(INVOKE_PREFIX.length()), stdinStream, bridge);
                return true;
            }
            if (line.startsWith(PLUGIN_PREFIX)) {
                handlePlugin(line.substring(PLUGIN_PREFIX.length()), stdinStream, bridge);
                return true;
            }
            if (line.startsWith(STATE_PREFIX)) {
                handleState(line.substring(STATE_PREFIX.length()), stdinStream, bridge);
                return true;
            }
            if (line.startsWith(SHELL_PREFIX)) {
                handleShell(line.substring(SHELL_PREFIX.length()), stdinStream, bridge);
                return true;
            }
            return false;
        });
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

    private void handleShell(String payload,
                             OutputStream stdinStream,
                             PythonBridge bridge) {
        handleBridgeMessage(payload, stdinStream, bridge,
                "Python Shell 桥接未初始化",
                this::parseShellRequest, PythonBridge::respondShell);
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
            throw new IllegalStateException("写入 Python 桥接响应失败", e);
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
        return new PythonPluginRequest(
                stringField(value, "pluginId"),
                stringField(value, "action"),
                mapField(value, "args"),
                mapField(value, "options")
        );
    }

    private PythonShellRequest parseShellRequest(String payload) {
        Map<String, Object> value = jsonCodec.readMap(payload);
        return new PythonShellRequest(
                stringField(value, "operation"),
                stringField(value, "command"),
                listField(value, "args"),
                mapField(value, "options")
        );
    }

    private static String stringField(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v == null ? null : String.valueOf(v);
    }

    private static Map<String, Object> mapField(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v instanceof Map<?, ?> m ? MapValueConverter.toResultMap(m) : Map.of();
    }

    private static List<Object> listField(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v instanceof List<?> list ? List.copyOf(list) : List.of();
    }

    private ProcessSupport.LogEvent parseLogEvent(String line) {
        return ProcessSupport.parseLogEvent(line, PythonEnvironmentManager.LOG_PREFIX, jsonCodec);
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

    record PythonInvocationRequest(String scriptId, Map<String, Object> args) {
    }

    record PythonPluginRequest(String pluginId, String action, Map<String, Object> args, Map<String, Object> options) {
    }

    record PythonStateRequest(String operation,
                              String namespace,
                              String key,
                              Long expectedVersion,
                              Object value,
                              Map<String, Object> options) {
    }

    record PythonShellRequest(String operation,
                              String command,
                              List<Object> args,
                              Map<String, Object> options) {
    }

}
