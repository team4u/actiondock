package org.team4u.actiondock.script;

import org.team4u.actiondock.application.PythonRequirementsSupport;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ExecutionLogLevel;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.repository.RepositoryVersionUtils;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.io.IOException;
import java.io.InputStream;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.ForkJoinPool;
import java.util.function.Consumer;

/**
 * Python 虚拟环境管理器，负责虚拟环境的生命周期管理和依赖安装。
 * <p>
 * 提供从运行时检测、虚拟环境创建到依赖安装的完整流程，
 * 并通过文件锁保证并发安全的环境缓存机制。
 *
 * @author jay.wu
 */
class PythonEnvironmentManager {

    /**
     * stderr 日志协议前缀，与 Python 脚本端的日志输出协议一致。
     */
    static final String LOG_PREFIX = "__ACTIONDOCK_LOG__";

    private static final String VENV_VALIDATION_RUNNER = """
            import json
            import sys
            import venv
            
            print(json.dumps({
                'version': '{}.{}.{}'.format(sys.version_info.major, sys.version_info.minor, sys.version_info.micro),
                'executable': sys.executable
            }, ensure_ascii=False))
            """;

    private final JsonCodec jsonCodec;
    private final AppProperties.Python properties;
    private final Executor asyncExecutor;

    PythonEnvironmentManager(JsonCodec jsonCodec, AppProperties.Python properties) {
        this(jsonCodec, properties, null);
    }

    PythonEnvironmentManager(JsonCodec jsonCodec,
                             AppProperties.Python properties,
                             Executor asyncExecutor) {
        this.jsonCodec = Objects.requireNonNull(jsonCodec);
        this.properties = Objects.requireNonNull(properties);
        this.asyncExecutor = asyncExecutor == null ? ForkJoinPool.commonPool() : asyncExecutor;
    }

    /**
     * 解析运行时可执行文件路径，根据依赖需求选择系统 Python 或虚拟环境中的 Python。
     *
     * @param parsedRequirements 解析后的 Python 依赖需求
     * @param definition         脚本定义
     * @param executionContext   执行上下文
     * @param baseExecutable     基础 Python 可执行文件路径（系统 Python）
     * @return Python 可执行文件信息
     * @throws IOException          如果环境准备失败
     * @throws InterruptedException 如果被中断
     */
    PythonExecutable resolveRuntimeExecutable(PythonRequirementsSupport.ParsedPythonRequirements parsedRequirements,
                                              ScriptDefinition definition,
                                              ScriptExecutionContext executionContext,
                                              String baseExecutable)
            throws IOException, InterruptedException {
        PythonRuntimeInfo runtimeInfo = inspectRuntime(baseExecutable, definition.getId());
        if (parsedRequirements == null || parsedRequirements.isEmpty()) {
            return new PythonExecutable(baseExecutable, runtimeInfo.version());
        }
        Path envDir = prepareEnvironment(baseExecutable, runtimeInfo, parsedRequirements, definition, executionContext);
        return new PythonExecutable(resolveEnvironmentPython(envDir), runtimeInfo.version());
    }

    /**
     * 检测 Python 运行时版本信息。
     *
     * @param executable Python 可执行文件路径
     * @param scriptId   脚本标识，用于错误信息
     * @return Python 运行时信息
     * @throws IOException          如果检测失败
     * @throws InterruptedException 如果被中断
     */
    PythonRuntimeInfo inspectRuntime(String executable, String scriptId) throws IOException, InterruptedException {
        ProcessSupport.ProcessResult result = runCommand(
                List.of(executable, "-c", VENV_VALIDATION_RUNNER),
                null,
                "{}",
                null,
                properties.getInstallTimeoutSeconds()
        );
        if (result.timedOut()) {
            throw new PythonExecutionException(
                    "检测 Python 运行环境超时",
                    ProcessSupport.buildSimpleErrorDetail("PYTHON_RUNTIME_MISSING", Map.of(
                            "scriptId", scriptId,
                            "executable", executable,
                            "reason", "检测 Python 运行环境超时"
                    ))
            );
        }
        if (result.exitCode() != 0) {
            throw new PythonExecutionException(
                    "Python 运行环境不可用",
                    ProcessSupport.buildErrorDetail("PYTHON_RUNTIME_MISSING", result, Map.of(
                            "scriptId", scriptId,
                            "executable", executable
                    ))
            );
        }
        Map<String, Object> payload = jsonCodec.readMap(result.stdout());
        Object version = payload.get("version");
        return new PythonRuntimeInfo(version == null ? "" : String.valueOf(version));
    }

    /**
     * 准备虚拟环境，如果缓存中已有就绪的环境则直接复用。
     *
     * @param executable         Python 可执行文件路径
     * @param runtimeInfo        运行时信息
     * @param parsedRequirements 解析后的依赖需求
     * @param definition         脚本定义
     * @param executionContext   执行上下文
     * @return 虚拟环境目录路径
     * @throws IOException          如果环境准备失败
     * @throws InterruptedException 如果被中断
     */
    Path prepareEnvironment(String executable,
                            PythonRuntimeInfo runtimeInfo,
                            PythonRequirementsSupport.ParsedPythonRequirements parsedRequirements,
                            ScriptDefinition definition,
                            ScriptExecutionContext executionContext)
            throws IOException, InterruptedException {
        Path cacheRoot = resolveEnvCacheDir();
        Files.createDirectories(cacheRoot);
        String cacheKey = RepositoryVersionUtils.sha256(parsedRequirements.cacheKeyMaterial(executable, runtimeInfo.version()));
        Path envDir = cacheRoot.resolve(cacheKey);
        Path readyFile = envDir.resolve("READY");
        if (Files.isRegularFile(readyFile)) {
            return envDir;
        }

        Files.createDirectories(envDir);
        Path lockFile = envDir.resolve(".lock");
        try (FileChannel channel = FileChannel.open(lockFile, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
             FileLock ignored = channel.lock()) {
            if (Files.isRegularFile(readyFile)) {
                return envDir;
            }
            clearDirectoryContents(envDir, Set.of(".lock"));
            installEnvironment(executable, envDir, parsedRequirements, definition, executionContext);
            Files.writeString(readyFile, "ready\n", StandardCharsets.UTF_8);
        }
        return envDir;
    }

    /**
     * 安装虚拟环境，包括创建虚拟环境和安装 pip 依赖。
     *
     * @param executable         Python 可执行文件路径
     * @param envDir             虚拟环境目录
     * @param parsedRequirements 解析后的依赖需求
     * @param definition         脚本定义
     * @param executionContext   执行上下文
     * @throws IOException          如果安装失败
     * @throws InterruptedException 如果被中断
     */
    void installEnvironment(String executable,
                            Path envDir,
                            PythonRequirementsSupport.ParsedPythonRequirements parsedRequirements,
                            ScriptDefinition definition,
                            ScriptExecutionContext executionContext)
            throws IOException, InterruptedException {
        if (executionContext != null) {
            executionContext.log(ExecutionLogLevel.INFO, "[python-install] Preparing virtual environment");
        }
        createVirtualEnvironment(executable, envDir, definition, executionContext);
        installPipDependencies(envDir, parsedRequirements, definition, executionContext);
    }

    /**
     * 使用 Python venv 模块创建虚拟环境。
     *
     * @param executable       Python 可执行文件路径
     * @param envDir           虚拟环境目录
     * @param definition       脚本定义
     * @param executionContext 执行上下文
     * @throws IOException          如果创建失败
     * @throws InterruptedException 如果被中断
     */
    void createVirtualEnvironment(String executable,
                                  Path envDir,
                                  ScriptDefinition definition,
                                  ScriptExecutionContext executionContext)
            throws IOException, InterruptedException {
        ProcessSupport.ProcessResult venvResult = runLoggedCommand(
                List.of(executable, "-m", "venv", envDir.toAbsolutePath().toString()),
                executionContext,
                properties.getInstallTimeoutSeconds()
        );
        if (venvResult.timedOut() || venvResult.exitCode() != 0) {
            throw new PythonExecutionException(
                    "Python 虚拟环境创建失败",
                    ProcessSupport.buildErrorDetail("PYTHON_ENV_PREPARE_FAILED", venvResult, Map.of(
                            "scriptId", definition.getId(),
                            "envDir", envDir.toString()
                    ))
            );
        }
    }

    /**
     * 使用 pip 安装依赖到指定虚拟环境。
     *
     * @param envDir             虚拟环境目录
     * @param parsedRequirements 解析后的依赖需求
     * @param definition         脚本定义
     * @param executionContext   执行上下文
     * @throws IOException          如果安装失败
     * @throws InterruptedException 如果被中断
     */
    void installPipDependencies(Path envDir,
                                PythonRequirementsSupport.ParsedPythonRequirements parsedRequirements,
                                ScriptDefinition definition,
                                ScriptExecutionContext executionContext)
            throws IOException, InterruptedException {
        Path requirementsPath = envDir.resolve("requirements.txt");
        Files.writeString(requirementsPath, parsedRequirements.normalizedText(), StandardCharsets.UTF_8);
        List<String> installCommand = new ArrayList<>(List.of(
                resolveEnvironmentPython(envDir),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--no-input",
                "-r",
                requirementsPath.toAbsolutePath().toString()
        ));
        ProcessSupport.ProcessResult pipResult = runLoggedCommand(
                installCommand,
                executionContext,
                properties.getInstallTimeoutSeconds()
        );
        if (pipResult.timedOut() || pipResult.exitCode() != 0) {
            throw new PythonExecutionException(
                    "Python 依赖安装失败",
                    ProcessSupport.buildErrorDetail("PYTHON_DEP_INSTALL_FAILED", pipResult, Map.of(
                            "scriptId", definition.getId(),
                            "envDir", envDir.toString(),
                            "requirements", parsedRequirements.normalizedText(),
                            "command", installCommand
                    ))
            );
        }
    }

    /**
     * 解析环境缓存目录路径。
     *
     * @return 环境缓存目录路径
     */
    private Path resolveEnvCacheDir() {
        String configured = properties.getEnvCacheDir();
        if (NormalizeUtils.isBlank(configured)) {
            return Path.of(AppProperties.defaultHomeDir(), "python-envs");
        }
        return Path.of(configured.trim());
    }

    /**
     * 解析虚拟环境中的 Python 可执行文件路径。
     *
     * @param envDir 虚拟环境目录
     * @return Python 可执行文件的绝对路径字符串
     */
    private static String resolveEnvironmentPython(Path envDir) {
        Path unix = envDir.resolve("bin").resolve("python");
        if (Files.exists(unix)) {
            return unix.toString();
        }
        return envDir.resolve("Scripts").resolve("python.exe").toString();
    }

    // ---- 进程运行辅助方法 ----

    private ProcessSupport.ProcessResult runCommand(List<String> command,
                                                    String stdin,
                                                    String configJson,
                                                    Consumer<ProcessSupport.LogEvent> logConsumer,
                                                    int timeoutSeconds)
            throws IOException, InterruptedException {
        ProcessBuilder processBuilder = new ProcessBuilder();
        processBuilder.command(command);
        processBuilder.environment().put("ACTIONDOCK_CONFIG_JSON", configJson == null ? "{}" : configJson);
        Process process = processBuilder.start();
        CompletableFuture<String> stdoutFuture = CompletableFuture.supplyAsync(() -> ProcessSupport.readStream(process.getInputStream()), asyncExecutor);
        CompletableFuture<String> stderrFuture = CompletableFuture.supplyAsync(() ->
                readErrorStreamForEnv(
                        process.getErrorStream(),
                        logConsumer == null ? event -> {
                        } : logConsumer
                ), asyncExecutor);

        return ProcessSupport.runProcessToCompletion(process, stdin, stdoutFuture, stderrFuture, timeoutSeconds, properties.getTimeoutSeconds());
    }

    private ProcessSupport.ProcessResult runLoggedCommand(List<String> command,
                                                          ScriptExecutionContext executionContext,
                                                          int timeoutSeconds)
            throws IOException, InterruptedException {
        Process process = new ProcessBuilder(command).start();
        CompletableFuture<String> stdoutFuture = CompletableFuture.supplyAsync(() ->
                readLoggedStream(process.getInputStream(), line -> logInstallLine(executionContext, ExecutionLogLevel.INFO, line)));
        CompletableFuture<String> stderrFuture = CompletableFuture.supplyAsync(() ->
                readLoggedStream(process.getErrorStream(), line -> logInstallLine(executionContext, ExecutionLogLevel.WARN, line)));
        return ProcessSupport.runProcessToCompletion(process, null, stdoutFuture, stderrFuture, timeoutSeconds, properties.getTimeoutSeconds());
    }

    // ---- 日志和流读取辅助方法 ----

    private static void logInstallLine(ScriptExecutionContext executionContext, ExecutionLogLevel level, String line) {
        if (executionContext != null && NormalizeUtils.isNotBlank(line)) {
            executionContext.log(level, "[python-install] " + line);
        }
    }

    private static String readLoggedStream(InputStream stream, Consumer<String> lineConsumer) {
        return ProcessSupport.readStreamLineByLine(stream, line -> {
            if (lineConsumer != null) {
                lineConsumer.accept(line);
            }
            return false;
        });
    }

    private String readErrorStreamForEnv(InputStream stream, Consumer<ProcessSupport.LogEvent> logConsumer) {
        return ProcessSupport.readStreamLineByLine(stream, line -> {
            ProcessSupport.LogEvent event = parseLogEvent(line);
            if (event != null) {
                logConsumer.accept(event);
                return true;
            }
            return false;
        });
    }

    private ProcessSupport.LogEvent parseLogEvent(String line) {
        return ProcessSupport.parseLogEvent(line, LOG_PREFIX, jsonCodec);
    }

    // ---- 文件系统辅助方法 ----

    /**
     * 清空目录内容，但保留指定名称的文件。
     *
     * @param directory     目标目录
     * @param preserveNames 需要保留的文件名集合
     * @throws IOException 如果清空失败
     */
    private static void clearDirectoryContents(Path directory, Set<String> preserveNames) throws IOException {
        if (Files.notExists(directory)) {
            return;
        }
        try (var children = Files.list(directory)) {
            for (Path child : children.toList()) {
                if (preserveNames.contains(child.getFileName().toString())) {
                    continue;
                }
                deleteRecursively(child);
            }
        }
    }

    /**
     * 递归删除文件或目录。
     *
     * @param path 目标路径
     * @throws IOException 如果删除失败
     */
    private static void deleteRecursively(Path path) throws IOException {
        if (Files.isDirectory(path) && !Files.isSymbolicLink(path)) {
            try (var children = Files.list(path)) {
                for (Path child : children.toList()) {
                    deleteRecursively(child);
                }
            }
        }
        Files.deleteIfExists(path);
    }

    /**
     * Python 可执行文件信息，包含路径和版本号。
     */
    record PythonExecutable(String path, String version) {
    }

    /**
     * Python 运行时信息，包含版本号。
     */
    record PythonRuntimeInfo(String version) {
    }
}
