package org.team4u.scriptflow.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.util.UriUtils;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.Spec;
import picocli.CommandLine.Model.CommandSpec;

import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Callable;

@Command(
        name = "scriptflow",
        mixinStandardHelpOptions = true,
        description = "Thin REST CLI for ScriptFlow",
        subcommands = {
                ScriptFlowCommand.ConfigCommands.class,
                ScriptFlowCommand.ScriptsCommands.class,
                ScriptFlowCommand.ExecutionsCommands.class,
                ScriptFlowCommand.PluginsCommands.class,
                ScriptFlowCommand.SchedulesCommands.class
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

    private final CliServices services;
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

    @Command(name = "config", subcommands = {CurrentConfig.class, ProfileCommands.class})
    static class ConfigCommands implements Runnable {
        @ParentCommand
        ScriptFlowCommand root;

        @Spec
        CommandSpec spec;

        ScriptFlowCommand root() {
            return root;
        }

        @Override
        public void run() {
            spec.commandLine().usage(root.services.stdout());
        }
    }

    @Command(name = "current")
    static class CurrentConfig implements Callable<Integer> {
        @ParentCommand
        ConfigCommands parent;

        @Override
        public Integer call() {
            return parent.root().emitLocalSuccess(parent.root().configService().toResolvedNode(parent.root().resolveConnectionConfig()));
        }
    }

    @Command(name = "profile", subcommands = {ListProfiles.class, GetProfile.class, SetProfile.class, DeleteProfile.class})
    static class ProfileCommands implements Runnable {
        @ParentCommand
        ConfigCommands parent;

        @Spec
        CommandSpec spec;

        ScriptFlowCommand root() {
            return parent.root();
        }

        @Override
        public void run() {
            spec.commandLine().usage(root().services.stdout());
        }
    }

    @Command(name = "list")
    static class ListProfiles implements Callable<Integer> {
        @ParentCommand
        ProfileCommands parent;

        @Override
        public Integer call() {
            CliConfigService.ConfigFile file = parent.root().loadConfigFile();
            return parent.root().emitLocalSuccess(parent.root().configService().toProfilesNode(file));
        }
    }

    @Command(name = "get")
    static class GetProfile implements Callable<Integer> {
        @ParentCommand
        ProfileCommands parent;

        @Parameters(index = "0", description = "Profile name")
        String profileName;

        @Override
        public Integer call() {
            CliConfigService.ConfigFile file = parent.root().loadConfigFile();
            CliConfigService.ProfileConfig profile = file.getProfiles().get(profileName);
            if (profile == null) {
                throw CliException.business(parent.root().output(), "profile 不存在: " + profileName);
            }
            return parent.root().emitLocalSuccess(
                    parent.root().configService().toProfileNode(profileName, profile, profileName.equals(file.getCurrentProfile()))
            );
        }
    }

    @Command(name = "set")
    static class SetProfile implements Callable<Integer> {
        @ParentCommand
        ProfileCommands parent;

        @Parameters(index = "0", description = "Profile name")
        String profileName;

        @Option(names = "--base-url")
        String baseUrl;

        @Option(names = "--token")
        String token;

        @Option(names = "--connect-timeout-ms")
        Integer connectTimeoutMs;

        @Option(names = "--read-timeout-ms")
        Integer readTimeoutMs;

        @Override
        public Integer call() {
            CliConfigService.ConfigFile file = parent.root().loadConfigFile();
            CliConfigService.ProfileConfig profile = file.getProfiles().getOrDefault(profileName, new CliConfigService.ProfileConfig());
            if (baseUrl != null) {
                profile.setBaseUrl(parent.root().configService().normalizeBaseUrl(baseUrl));
            }
            if (token != null) {
                profile.setToken(parent.root().configService().normalizeString(token));
            }
            if (connectTimeoutMs != null) {
                profile.setConnectTimeoutMs(connectTimeoutMs);
            }
            if (readTimeoutMs != null) {
                profile.setReadTimeoutMs(readTimeoutMs);
            }
            file.getProfiles().put(profileName, profile);
            file.setCurrentProfile(profileName);
            parent.root().saveConfigFile(file);
            return parent.root().emitLocalSuccess(
                    parent.root().configService().toProfileNode(profileName, profile, true),
                    "配置已保存"
            );
        }
    }

    @Command(name = "delete")
    static class DeleteProfile implements Callable<Integer> {
        @ParentCommand
        ProfileCommands parent;

        @Parameters(index = "0", description = "Profile name")
        String profileName;

        @Override
        public Integer call() {
            CliConfigService.ConfigFile file = parent.root().loadConfigFile();
            CliConfigService.ProfileConfig removed = file.getProfiles().remove(profileName);
            if (removed == null) {
                throw CliException.business(parent.root().output(), "profile 不存在: " + profileName);
            }
            if (profileName.equals(file.getCurrentProfile())) {
                file.setCurrentProfile(null);
            }
            parent.root().saveConfigFile(file);
            return parent.root().emitLocalSuccess(parent.root().configService().toProfilesNode(file), "配置已删除");
        }
    }

    @Command(name = "scripts", subcommands = {
            ListScripts.class, GetScript.class, GetPublishedScript.class, GetScriptSchema.class,
            CreateScript.class, UpdateScript.class, DeleteScript.class, ValidateScript.class,
            PublishScript.class, DiscardDraftScript.class, ExecutePublishedScript.class
    })
    static class ScriptsCommands implements Runnable {
        @ParentCommand
        ScriptFlowCommand root;

        @Spec
        CommandSpec spec;

        ScriptFlowCommand root() {
            return root;
        }

        @Override
        public void run() {
            spec.commandLine().usage(root.services.stdout());
        }
    }

    @Command(name = "list")
    static class ListScripts implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Override
        public Integer call() {
            ScriptFlowApiClient client = parent.root().apiClient();
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(client.get("/api/scripts", query));
        }
    }

    @Command(name = "get")
    static class GetScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

        @Override
        public Integer call() {
            ScriptFlowApiClient client = parent.root().apiClient();
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(client.get("/api/scripts/" + parent.root().encodePath(scriptId), query));
        }
    }

    @Command(name = "get-published")
    static class GetPublishedScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

        @Override
        public Integer call() {
            ScriptFlowApiClient client = parent.root().apiClient();
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(client.get("/api/scripts/" + parent.root().encodePath(scriptId) + "/published", query));
        }
    }

    @Command(name = "schema")
    static class GetScriptSchema implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/schema/" + parent.root().encodePath(scriptId), Map.of()));
        }
    }

    @Command(name = "create")
    static class CreateScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Option(names = "--file", required = true)
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "脚本定义");
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(parent.root().apiClient().postJson("/api/scripts", query, body));
        }
    }

    @Command(name = "update")
    static class UpdateScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

        @Option(names = "--file", required = true)
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "脚本定义");
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(parent.root().apiClient().putJson(
                    "/api/scripts/" + parent.root().encodePath(scriptId),
                    query,
                    body
            ));
        }
    }

    @Command(name = "delete")
    static class DeleteScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/scripts/" + parent.root().encodePath(scriptId), Map.of()));
        }
    }

    @Command(name = "validate")
    static class ValidateScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson(
                    "/api/scripts/" + parent.root().encodePath(scriptId) + "/validate",
                    Map.of(),
                    "{}"
            ));
        }
    }

    @Command(name = "publish")
    static class PublishScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

        @Override
        public Integer call() {
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(parent.root().apiClient().postJson(
                    "/api/scripts/" + parent.root().encodePath(scriptId) + "/publish",
                    query,
                    "{}"
            ));
        }
    }

    @Command(name = "discard-draft")
    static class DiscardDraftScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

        @Override
        public Integer call() {
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(parent.root().apiClient().postJson(
                    "/api/scripts/" + parent.root().encodePath(scriptId) + "/discard-draft",
                    query,
                    "{}"
            ));
        }
    }

    @Command(name = "execute-published")
    static class ExecutePublishedScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

        @Option(names = "--input")
        String input;

        @Option(names = "--input-file")
        String inputFile;

        @Option(names = "--mode", defaultValue = "SYNC")
        SubmitModeOption mode;

        @Option(names = "--response-view", defaultValue = "RESULT")
        ResponseViewOption responseView;

        @Option(names = "--wait")
        boolean wait;

        @Option(names = "--wait-timeout-seconds", defaultValue = "30")
        long waitTimeoutSeconds;

        @Option(names = "--poll-interval-ms", defaultValue = "1000")
        long pollIntervalMs;

        @Override
        public Integer call() {
            ScriptFlowCommand root = parent.root();
            ScriptFlowApiClient client = root.apiClient();
            String resolvedInput = JsonInputSupport.readOptionalJsonObject(root.output(), root.objectMapper(), input, inputFile, "执行入参");
            String body = root.jsonObject(Map.of(
                    "input", readTree(root, resolvedInput),
                    "mode", mode.name(),
                    "responseView", responseView.name()
            ));
            JsonNode response = client.postJson("/api/scripts/" + root.encodePath(scriptId) + "/published/execute", Map.of(), body);
            if (wait) {
                response = root.waitForExecution(client, response, waitTimeoutSeconds, pollIntervalMs);
            }
            return root.emit(response);
        }
    }

    @Command(name = "executions", subcommands = {SubmitExecution.class, GetExecution.class, ListExecutions.class, DeleteExecution.class, ClearExecutions.class})
    static class ExecutionsCommands implements Runnable {
        @ParentCommand
        ScriptFlowCommand root;

        @Spec
        CommandSpec spec;

        ScriptFlowCommand root() {
            return root;
        }

        @Override
        public void run() {
            spec.commandLine().usage(root.services.stdout());
        }
    }

    @Command(name = "submit")
    static class SubmitExecution implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Option(names = "--script-id", required = true)
        String scriptId;

        @Option(names = "--input")
        String input;

        @Option(names = "--input-file")
        String inputFile;

        @Option(names = "--mode", defaultValue = "SYNC")
        SubmitModeOption mode;

        @Option(names = "--response-view", defaultValue = "RESULT")
        ResponseViewOption responseView;

        @Option(names = "--wait")
        boolean wait;

        @Option(names = "--wait-timeout-seconds", defaultValue = "30")
        long waitTimeoutSeconds;

        @Option(names = "--poll-interval-ms", defaultValue = "1000")
        long pollIntervalMs;

        @Override
        public Integer call() {
            ScriptFlowCommand root = parent.root();
            ScriptFlowApiClient client = root.apiClient();
            String resolvedInput = JsonInputSupport.readOptionalJsonObject(root.output(), root.objectMapper(), input, inputFile, "执行入参");
            String body = root.jsonObject(Map.of(
                    "scriptId", scriptId,
                    "input", readTree(root, resolvedInput),
                    "mode", mode.name(),
                    "responseView", responseView.name()
            ));
            JsonNode response = client.postJson("/api/executions", Map.of(), body);
            if (wait) {
                response = root.waitForExecution(client, response, waitTimeoutSeconds, pollIntervalMs);
            }
            return root.emit(response);
        }
    }

    @Command(name = "get")
    static class GetExecution implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Parameters(index = "0")
        String executionId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/executions/" + parent.root().encodePath(executionId), Map.of()));
        }
    }

    @Command(name = "list")
    static class ListExecutions implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Option(names = "--script-id")
        String scriptId;

        @Override
        public Integer call() {
            Map<String, Object> query = new LinkedHashMap<>();
            if (scriptId != null && !scriptId.isBlank()) {
                query.put("scriptId", scriptId);
            }
            return parent.root().emit(parent.root().apiClient().get("/api/executions", query));
        }
    }

    @Command(name = "delete")
    static class DeleteExecution implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Parameters(index = "0")
        String executionId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/executions/" + parent.root().encodePath(executionId), Map.of()));
        }
    }

    @Command(name = "clear")
    static class ClearExecutions implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Option(names = "--script-id")
        String scriptId;

        @Override
        public Integer call() {
            Map<String, Object> query = new LinkedHashMap<>();
            if (scriptId != null && !scriptId.isBlank()) {
                query.put("scriptId", scriptId);
            }
            return parent.root().emit(parent.root().apiClient().delete("/api/executions", query));
        }
    }

    @Command(name = "plugins", subcommands = {
            ListPlugins.class, GetPlugin.class, InstallPlugin.class, UpgradePlugin.class,
            StartPlugin.class, StopPlugin.class, DeletePlugin.class, InvokePlugin.class, PluginConfigCommands.class
    })
    static class PluginsCommands implements Runnable {
        @ParentCommand
        ScriptFlowCommand root;

        @Spec
        CommandSpec spec;

        ScriptFlowCommand root() {
            return root;
        }

        @Override
        public void run() {
            spec.commandLine().usage(root.services.stdout());
        }
    }

    @Command(name = "list")
    static class ListPlugins implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/plugins", Map.of()));
        }
    }

    @Command(name = "get")
    static class GetPlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0")
        String pluginId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/plugins/" + parent.root().encodePath(pluginId), Map.of()));
        }
    }

    @Command(name = "install")
    static class InstallPlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Option(names = "--jar", required = true)
        String jarPath;

        @Override
        public Integer call() {
            ScriptFlowCommand root = parent.root();
            byte[] content = JsonInputSupport.readBinaryFile(root.output(), jarPath, "插件 JAR");
            return root.emit(root.apiClient().postMultipart("/api/plugins/install", Map.of(), "file", Path.of(jarPath), content));
        }
    }

    @Command(name = "upgrade")
    static class UpgradePlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0")
        String pluginId;

        @Option(names = "--jar", required = true)
        String jarPath;

        @Override
        public Integer call() {
            ScriptFlowCommand root = parent.root();
            byte[] content = JsonInputSupport.readBinaryFile(root.output(), jarPath, "插件 JAR");
            return root.emit(root.apiClient().postMultipart(
                    "/api/plugins/" + root.encodePath(pluginId) + "/upgrade",
                    Map.of(),
                    "file",
                    Path.of(jarPath),
                    content
            ));
        }
    }

    @Command(name = "start")
    static class StartPlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0")
        String pluginId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson("/api/plugins/" + parent.root().encodePath(pluginId) + "/start", Map.of(), "{}"));
        }
    }

    @Command(name = "stop")
    static class StopPlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0")
        String pluginId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson("/api/plugins/" + parent.root().encodePath(pluginId) + "/stop", Map.of(), "{}"));
        }
    }

    @Command(name = "delete")
    static class DeletePlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0")
        String pluginId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/plugins/" + parent.root().encodePath(pluginId), Map.of()));
        }
    }

    @Command(name = "invoke")
    static class InvokePlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0")
        String pluginId;

        @Parameters(index = "1")
        String action;

        @Option(names = "--args")
        String args;

        @Option(names = "--args-file")
        String argsFile;

        @Option(names = "--script-input")
        String scriptInput;

        @Option(names = "--script-input-file")
        String scriptInputFile;

        @Option(names = "--response-view", defaultValue = "RESULT")
        ResponseViewOption responseView;

        @Override
        public Integer call() {
            ScriptFlowCommand root = parent.root();
            String resolvedArgs = JsonInputSupport.readOptionalJsonObject(root.output(), root.objectMapper(), args, argsFile, "插件参数");
            String resolvedScriptInput = JsonInputSupport.readOptionalJsonObject(root.output(), root.objectMapper(), scriptInput, scriptInputFile, "脚本输入");
            String body = root.jsonObject(Map.of(
                    "args", readTree(root, resolvedArgs),
                    "scriptInput", readTree(root, resolvedScriptInput),
                    "responseView", responseView.name()
            ));
            return root.emit(root.apiClient().postJson(
                    "/api/plugins/" + root.encodePath(pluginId) + "/actions/" + root.encodePath(action) + "/invoke",
                    Map.of(),
                    body
            ));
        }
    }

    @Command(name = "config", subcommands = {GetPluginConfig.class, SetPluginConfig.class})
    static class PluginConfigCommands implements Runnable {
        @ParentCommand
        PluginsCommands parent;

        @Spec
        CommandSpec spec;

        ScriptFlowCommand root() {
            return parent.root();
        }

        @Override
        public void run() {
            spec.commandLine().usage(root().services.stdout());
        }
    }

    @Command(name = "get")
    static class GetPluginConfig implements Callable<Integer> {
        @ParentCommand
        PluginConfigCommands parent;

        @Parameters(index = "0")
        String pluginId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/plugins/" + parent.root().encodePath(pluginId) + "/config", Map.of()));
        }
    }

    @Command(name = "set")
    static class SetPluginConfig implements Callable<Integer> {
        @ParentCommand
        PluginConfigCommands parent;

        @Parameters(index = "0")
        String pluginId;

        @Option(names = "--file", required = true)
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "插件配置请求体");
            return parent.root().emit(parent.root().apiClient().putJson(
                    "/api/plugins/" + parent.root().encodePath(pluginId) + "/config",
                    Map.of(),
                    body
            ));
        }
    }

    @Command(name = "schedules", subcommands = {
            ListSchedules.class, GetSchedule.class, CreateSchedule.class, UpdateSchedule.class,
            EnableSchedule.class, DisableSchedule.class, DeleteSchedule.class
    })
    static class SchedulesCommands implements Runnable {
        @ParentCommand
        ScriptFlowCommand root;

        @Spec
        CommandSpec spec;

        ScriptFlowCommand root() {
            return root;
        }

        @Override
        public void run() {
            spec.commandLine().usage(root.services.stdout());
        }
    }

    @Command(name = "list")
    static class ListSchedules implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Option(names = "--script-id")
        String scriptId;

        @Override
        public Integer call() {
            if (scriptId != null && !scriptId.isBlank()) {
                return parent.root().emit(parent.root().apiClient().get(
                        "/api/scripts/" + parent.root().encodePath(scriptId) + "/schedules",
                        Map.of()
                ));
            }
            return parent.root().emit(parent.root().apiClient().get("/api/schedules", Map.of()));
        }
    }

    @Command(name = "get")
    static class GetSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0")
        String scheduleId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/schedules/" + parent.root().encodePath(scheduleId), Map.of()));
        }
    }

    @Command(name = "create")
    static class CreateSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Option(names = "--file", required = true)
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "定时任务请求体");
            return parent.root().emit(parent.root().apiClient().postJson("/api/schedules", Map.of(), body));
        }
    }

    @Command(name = "update")
    static class UpdateSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0")
        String scheduleId;

        @Option(names = "--file", required = true)
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "定时任务请求体");
            return parent.root().emit(parent.root().apiClient().putJson(
                    "/api/schedules/" + parent.root().encodePath(scheduleId),
                    Map.of(),
                    body
            ));
        }
    }

    @Command(name = "enable")
    static class EnableSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0")
        String scheduleId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson("/api/schedules/" + parent.root().encodePath(scheduleId) + "/enable", Map.of(), "{}"));
        }
    }

    @Command(name = "disable")
    static class DisableSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0")
        String scheduleId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson("/api/schedules/" + parent.root().encodePath(scheduleId) + "/disable", Map.of(), "{}"));
        }
    }

    @Command(name = "delete")
    static class DeleteSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0")
        String scheduleId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/schedules/" + parent.root().encodePath(scheduleId), Map.of()));
        }
    }

    private static JsonNode readTree(ScriptFlowCommand root, String json) {
        try {
            return root.objectMapper().readTree(json);
        } catch (Exception exception) {
            throw CliException.validation(root.output(), "请求体 JSON 解析失败");
        }
    }
}
