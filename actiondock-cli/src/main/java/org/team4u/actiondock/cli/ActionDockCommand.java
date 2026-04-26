package org.team4u.actiondock.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.util.UriUtils;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.ScopeType;
import picocli.CommandLine.Spec;
import picocli.CommandLine.Model.CommandSpec;

import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.Callable;

/**
 * CLI 根命令，提供全局连接配置和通用工具方法。
 * <p>
 * 包含 scripts、executions、plugins、schedules、config、config-values、repositories 等子命令组。
 *
 * @author jay.wu
 */
@Command(
        name = "actiondock",
        mixinStandardHelpOptions = true,
        description = {
                "Lightweight REST CLI for ActionDock.",
                "Connection config precedence: command-line flags > environment variables > profile file > defaults.",
                "Environment variables: ACTIONDOCK_PROFILE, ACTIONDOCK_BASE_URL, ACTIONDOCK_TOKEN.",
                "Defaults: profile=default, baseUrl=http://localhost:8080, connectTimeoutMs=5000, readTimeoutMs=30000."
        },
        subcommands = {
                DiscoverCommands.class,
                ConfigCommands.class,
                ScriptsCommands.class,
                ExecutionsCommands.class,
                PluginsCommands.class,
                SchedulesCommands.class,
                ConfigValuesCommands.class,
                RepositoriesCommands.class,
                PresetsCommands.class
        }
)
public class ActionDockCommand implements Runnable {
    enum SubmitModeOption {
        SYNC,
        ASYNC
    }

    enum ResponseViewOption {
        RESULT,
        DEBUG
    }

    @Option(names = "--profile", description = "Profile to use for this command. Overrides the current profile from env vars and the config file.")
    String profile;

    @Option(names = "--base-url", description = "ActionDock service base URL, for example http://localhost:8080. Overrides env vars and profile config.")
    String baseUrl;

    @Option(names = "--token", description = "Bearer token. Overrides env vars and profile config.")
    String token;

    @Option(names = "--connect-timeout-ms", description = "HTTP connect timeout in milliseconds. Default: 5000.")
    Integer connectTimeoutMs;

    @Option(names = "--read-timeout-ms", description = "HTTP read timeout in milliseconds. Default: 30000.")
    Integer readTimeoutMs;

    @Option(names = "--help-json", help = true, scope = ScopeType.INHERIT, description = "Print machine-readable command help as JSON and exit.")
    boolean helpJson;

    @Spec
    CommandSpec spec;

    final CliServices services;
    private final CliOutput output;
    private final CliConfigService configService;

    public ActionDockCommand() {
        this(CliServices.defaultServices());
    }

    ActionDockCommand(CliServices services) {
        this.services = services;
        this.output = new CliOutput(services.objectMapper(), services.stdout(), services.stderr());
        this.configService = new CliConfigService(services.objectMapper(), services.environment(), services.homeDirectory());
    }

    CliOutput output() {
        return output;
    }

    ObjectMapper objectMapper() {
        return services.objectMapper();
    }

    CliConfigService configService() {
        return configService;
    }

    /**
     * 加载 CLI 配置文件，解析失败时抛出配置异常。
     *
     * @return 配置文件对象
     * @throws CliException 如果配置文件读取或解析失败
     */
    CliConfigService.ConfigFile loadConfigFile() {
        try {
            return configService.load();
        } catch (UncheckedIOException exception) {
            throw CliException.config(output, "Failed to parse CLI config file");
        }
    }

    /**
     * 保存 CLI 配置文件，写入失败时抛出配置异常。
     *
     * @param file 要保存的配置文件对象
     * @throws CliException 如果配置文件写入失败
     */
    void saveConfigFile(CliConfigService.ConfigFile file) {
        try {
            configService.save(file);
        } catch (UncheckedIOException exception) {
            throw CliException.config(output, "Failed to save CLI config file");
        }
    }

    /**
     * 解析当前命令的连接配置。
     * <p>
     * 将命令行参数与环境变量、profile 文件和默认值进行合并。
     *
     * @return 最终生效的连接配置
     * @throws CliException 如果配置文件读取或解析失败
     */
    CliConfigService.ResolvedConnectionConfig resolveConnectionConfig() {
        try {
            return configService.resolve(new CliConfigService.ResolutionRequest(
                    profile,
                    baseUrl,
                    token,
                    connectTimeoutMs,
                    readTimeoutMs
            ));
        } catch (UncheckedIOException exception) {
            throw CliException.config(output, "Failed to parse CLI config file");
        }
    }

    /**
     * 创建已认证的 API 客户端实例。
     *
     * @return 基于当前连接配置创建的 API 客户端
     */
    ActionDockApiClient apiClient() {
        return services.apiClientFactory().create(resolveConnectionConfig(), objectMapper(), output);
    }

    /**
     * 将 JSON 信封输出到标准输出并返回成功退出码。
     *
     * @param envelope JSON 信封
     * @return 退出码 0
     */
    int emit(JsonNode envelope) {
        output.printStdout(envelope);
        return 0;
    }

    /**
     * 构建带自定义消息的本地成功响应并输出。
     *
     * @param data    业务数据
     * @param message 自定义消息
     * @return 退出码 0
     */
    int emitLocalSuccess(JsonNode data, String message) {
        return emit(output.success(data, message));
    }

    /**
     * 构建默认消息的本地成功响应并输出。
     *
     * @param data 业务数据
     * @return 退出码 0
     */
    int emitLocalSuccess(JsonNode data) {
        return emit(output.success(data));
    }

    /**
     * 将对象转换为 JSON 节点后构建本地成功响应并输出。
     *
     * @param value   业务数据对象
     * @param message 自定义消息
     * @return 退出码 0
     */
    int emitLocalSuccess(Object value, String message) {
        return emitLocalSuccess(objectMapper().valueToTree(value), message);
    }

    int submitRequest(CliRequest request, AgentExecutionOptions options) {
        return submitRequest(request, options, Map.of());
    }

    int submitRequest(CliRequest request, AgentExecutionOptions options, Map<String, Object> metadata) {
        options.validate(output);
        if (options.validateOnly()) {
            return emitLocalSuccess(CliRequestPreview.validation(objectMapper(), options.command()), "Validation passed");
        }
        if (options.dryRun()) {
            return emitLocalSuccess(CliRequestPreview.dryRun(objectMapper(), request, metadata), "Dry run");
        }
        return emit(executeRequest(request));
    }

    JsonNode executeRequest(CliRequest request) {
        ActionDockApiClient client = apiClient();
        return switch (request.method()) {
            case "GET" -> client.get(request.path(), request.query());
            case "DELETE" -> client.delete(request.path(), request.query());
            case "POST" -> request.multipartBody() == null
                    ? client.postJson(request.path(), request.query(), request.jsonBody())
                    : client.postMultipart(
                            request.path(),
                            request.query(),
                            request.multipartBody().fieldName(),
                            request.multipartBody().file(),
                            request.multipartBody().content()
                    );
            case "PUT" -> client.putJson(request.path(), request.query(), request.jsonBody());
            default -> throw CliException.validation(output, "Unsupported HTTP method for CLI request");
        };
    }

    /**
     * 将 Map 序列化为 JSON 字符串，用于构建请求体。
     *
     * @param value 键值对映射
     * @return JSON 字符串
     * @throws CliException 如果序列化失败
     */
    String jsonObject(Map<String, Object> value) {
        try {
            return objectMapper().writeValueAsString(value);
        } catch (Exception exception) {
            throw CliException.validation(output, "Failed to build request body JSON");
        }
    }

    /**
     * 对 URL 路径段进行编码，处理特殊字符。
     *
     * @param segment 原始路径段
     * @return URL 编码后的路径段
     */
    String encodePath(String segment) {
        return UriUtils.encodePathSegment(segment, StandardCharsets.UTF_8);
    }

    /**
     * 轮询等待执行完成。
     * <p>
     * 提交执行后，按指定间隔轮询执行状态，直到状态变为终态（非 PENDING/RUNNING）或超时。
     *
     * @param client            API 客户端
     * @param initialEnvelope   提交执行的初始响应
     * @param waitTimeoutSeconds 等待超时时间（秒）
     * @param pollIntervalMs    轮询间隔（毫秒）
     * @return 最终的执行结果响应
     * @throws CliException 如果响应中缺少 executionId、等待被中断或超时
     */
    JsonNode waitForExecution(ActionDockApiClient client,
                              JsonNode initialEnvelope,
                              long waitTimeoutSeconds,
                              long pollIntervalMs) {
        JsonNode initialData = initialEnvelope.path("data");
        String executionId = textValue(initialData.path("id"));
        if (executionId == null) {
            throw CliException.business(output, "Server response did not include executionId");
        }
        String currentStatus = textValue(initialData.path("status"));
        if (isTerminalStatus(currentStatus)) {
            return initialEnvelope;
        }

        long deadline = System.nanoTime() + Duration.ofSeconds(waitTimeoutSeconds).toNanos();
        JsonNode lastEnvelope = initialEnvelope;
        while (System.nanoTime() <= deadline) {
            try {
                services.sleeper().sleep(pollIntervalMs);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw CliException.transport(output, "Interrupted while waiting for execution result");
            }
            lastEnvelope = client.get("/api/executions/" + encodePath(executionId), Map.of());
            currentStatus = textValue(lastEnvelope.path("data").path("status"));
            if (isTerminalStatus(currentStatus)) {
                return lastEnvelope;
            }
        }

        throw CliException.timeout(
                output,
                "Timed out while waiting for execution result",
                objectMapper().valueToTree(Map.of(
                        "executionId", executionId,
                        "lastStatus", currentStatus,
                        "timeoutSeconds", waitTimeoutSeconds
                )),
                CliErrorDetails.timeout(output, "actiondock executions submit", java.util.List.of(
                        "actiondock executions get " + executionId,
                        "actiondock executions submit --script-id <scriptId> --wait --wait-timeout-seconds " + Math.max(waitTimeoutSeconds * 2, waitTimeoutSeconds + 1)
                ))
        );
    }

    private boolean isTerminalStatus(String status) {
        return status == null || (!"PENDING".equals(status) && !"RUNNING".equals(status));
    }

    private String textValue(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        String value = node.asText();
        return value == null || value.isBlank() ? null : value;
    }

    @Override
    public void run() {
        spec.commandLine().usage(services.stdout());
    }
}
