package org.team4u.scriptflow.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.util.UriUtils;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Spec;
import picocli.CommandLine.Model.CommandSpec;

import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.Callable;

@Command(
        name = "scriptflow",
        mixinStandardHelpOptions = true,
        description = "Thin REST CLI for ScriptFlow",
        subcommands = {
                ConfigCommands.class,
                ScriptsCommands.class,
                ExecutionsCommands.class,
                PluginsCommands.class,
                SchedulesCommands.class
        }
)
public class ScriptFlowCommand implements Runnable {
    enum SubmitModeOption {
        SYNC,
        ASYNC
    }

    enum ResponseViewOption {
        RESULT,
        DEBUG
    }

    @Option(names = "--profile")
    String profile;

    @Option(names = "--base-url")
    String baseUrl;

    @Option(names = "--token")
    String token;

    @Option(names = "--connect-timeout-ms")
    Integer connectTimeoutMs;

    @Option(names = "--read-timeout-ms")
    Integer readTimeoutMs;

    @Spec
    CommandSpec spec;

    final CliServices services;
    private final CliOutput output;
    private final CliConfigService configService;

    public ScriptFlowCommand() {
        this(CliServices.defaultServices());
    }

    ScriptFlowCommand(CliServices services) {
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

    CliConfigService.ConfigFile loadConfigFile() {
        try {
            return configService.load();
        } catch (UncheckedIOException exception) {
            throw CliException.config(output, "CLI 配置文件解析失败");
        }
    }

    void saveConfigFile(CliConfigService.ConfigFile file) {
        try {
            configService.save(file);
        } catch (UncheckedIOException exception) {
            throw CliException.config(output, "CLI 配置文件保存失败");
        }
    }

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
            throw CliException.config(output, "CLI 配置文件解析失败");
        }
    }

    ScriptFlowApiClient apiClient() {
        return services.apiClientFactory().create(resolveConnectionConfig(), objectMapper(), output);
    }

    int emit(JsonNode envelope) {
        output.printStdout(envelope);
        return 0;
    }

    int emitLocalSuccess(JsonNode data, String message) {
        return emit(output.success(data, message));
    }

    int emitLocalSuccess(JsonNode data) {
        return emit(output.success(data));
    }

    int emitLocalSuccess(Object value, String message) {
        return emitLocalSuccess(objectMapper().valueToTree(value), message);
    }

    String jsonObject(Map<String, Object> value) {
        try {
            return objectMapper().writeValueAsString(value);
        } catch (Exception exception) {
            throw CliException.validation(output, "请求体 JSON 生成失败");
        }
    }

    String encodePath(String segment) {
        return UriUtils.encodePathSegment(segment, StandardCharsets.UTF_8);
    }

    JsonNode waitForExecution(ScriptFlowApiClient client,
                              JsonNode initialEnvelope,
                              long waitTimeoutSeconds,
                              long pollIntervalMs) {
        JsonNode initialData = initialEnvelope.path("data");
        String executionId = textValue(initialData.path("id"));
        if (executionId == null) {
            throw CliException.business(output, "服务端未返回 executionId");
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
                throw CliException.transport(output, "等待执行结果时被中断");
            }
            lastEnvelope = client.get("/api/executions/" + encodePath(executionId), Map.of());
            currentStatus = textValue(lastEnvelope.path("data").path("status"));
            if (isTerminalStatus(currentStatus)) {
                return lastEnvelope;
            }
        }

        throw CliException.timeout(
                output,
                "等待执行结果超时",
                objectMapper().valueToTree(Map.of(
                        "executionId", executionId,
                        "lastStatus", currentStatus,
                        "timeoutSeconds", waitTimeoutSeconds
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
