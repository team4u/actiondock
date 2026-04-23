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
        description = {
                "Lightweight REST CLI for ScriptFlow.",
                "Connection config precedence: command-line flags > environment variables > profile file > defaults.",
                "Environment variables: SCRIPTFLOW_PROFILE, SCRIPTFLOW_BASE_URL, SCRIPTFLOW_TOKEN.",
                "Defaults: profile=default, baseUrl=http://localhost:8080, connectTimeoutMs=5000, readTimeoutMs=30000."
        },
        subcommands = {
                ConfigCommands.class,
                ScriptsCommands.class,
                ExecutionsCommands.class,
                PluginsCommands.class,
                SchedulesCommands.class
        }
)
/**
 * CLI 根命令，提供全局连接配置和通用工具方法。
 * <p>
 * 包含 scripts、executions、plugins、schedules、config 五个子命令组。
 *
 * @author jay.wu
 */
public class ScriptFlowCommand implements Runnable {
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

    @Option(names = "--base-url", description = "ScriptFlow service base URL, for example http://localhost:8080. Overrides env vars and profile config.")
    String baseUrl;

    @Option(names = "--token", description = "Bearer token. Overrides env vars and profile config.")
    String token;

    @Option(names = "--connect-timeout-ms", description = "HTTP connect timeout in milliseconds. Default: 5000.")
    Integer connectTimeoutMs;

    @Option(names = "--read-timeout-ms", description = "HTTP read timeout in milliseconds. Default: 30000.")
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
            throw CliException.config(output, "Failed to parse CLI config file");
        }
    }

    void saveConfigFile(CliConfigService.ConfigFile file) {
        try {
            configService.save(file);
        } catch (UncheckedIOException exception) {
            throw CliException.config(output, "Failed to save CLI config file");
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
            throw CliException.config(output, "Failed to parse CLI config file");
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
            throw CliException.validation(output, "Failed to build request body JSON");
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
