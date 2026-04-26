package org.team4u.actiondock.cli;

import com.fasterxml.jackson.databind.JsonNode;
import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.Spec;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;

@Command(name = "plugins", mixinStandardHelpOptions = true, description = "Commands for plugin installation, lifecycle operations, invocation, and config.", subcommands = {
        PluginsCommands.ListPlugins.class, PluginsCommands.GetPlugin.class, PluginsCommands.InstallPlugin.class, PluginsCommands.UpgradePlugin.class,
        PluginsCommands.StartPlugin.class, PluginsCommands.StopPlugin.class, PluginsCommands.DeletePlugin.class, PluginsCommands.InvokePlugin.class, PluginsCommands.PluginConfigCommands.class,
        PluginsCommands.RepositoryPluginCommands.class
})
/**
 * 插件管理命令组，提供插件的安装、启停、调用和配置等子命令。
 *
 * @author jay.wu
 */
class PluginsCommands implements Runnable {
    @ParentCommand
    ActionDockCommand root;

    @Spec
    CommandSpec spec;

    ActionDockCommand root() {
        return root;
    }

    @Command(name = "repository", mixinStandardHelpOptions = true, description = "Commands for repository-managed plugins.", subcommands = {
            ListRepositoryPlugins.class, GetRepositoryPlugin.class, InstallRepositoryPlugin.class, UpdateRepositoryPlugin.class, PublishRepositoryPlugin.class
    })
    static class RepositoryPluginCommands implements Runnable {
        @ParentCommand
        PluginsCommands parent;

        @Spec
        CommandSpec spec;

        ActionDockCommand root() {
            return parent.root();
        }

        @Override
        public void run() {
            spec.commandLine().usage(root().services.stdout());
        }
    }

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List plugins declared by repositories.")
    static class ListRepositoryPlugins implements Callable<Integer> {
        @ParentCommand
        RepositoryPluginCommands parent;

        @Option(names = "--repository-id", description = "Optional repository ID. If omitted, all enabled repositories are scanned.")
        String repositoryId;

        @Override
        public Integer call() {
            String path = repositoryId == null || repositoryId.isBlank()
                    ? "/api/repositories/plugins"
                    : "/api/repositories/" + parent.root().encodePath(repositoryId) + "/plugins";
            return parent.root().emit(parent.root().apiClient().get(path, Map.of()));
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Get details for a repository plugin.")
    static class GetRepositoryPlugin implements Callable<Integer> {
        @ParentCommand
        RepositoryPluginCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Parameters(index = "1", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.emit(root.apiClient().get(
                    "/api/repositories/" + root.encodePath(repositoryId) + "/plugins/" + root.encodePath(pluginId),
                    Map.of()
            ));
        }
    }

    @Command(name = "install", mixinStandardHelpOptions = true, description = "Install a plugin from a repository.")
    static class InstallRepositoryPlugin implements Callable<Integer> {
        @ParentCommand
        RepositoryPluginCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Parameters(index = "1", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        @Option(names = "--force", description = "Force installation when the target plugin version conflicts with installed tool dependency ranges.")
        boolean force;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without installing.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.submitRequest(
                    CliRequest.postJson("/api/repositories/" + root.encodePath(repositoryId) + "/plugins/" + root.encodePath(pluginId) + "/install", Map.of(), root.jsonObject(Map.of("force", force))),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock plugins repository install")
            );
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = "Update an installed plugin from a repository.")
    static class UpdateRepositoryPlugin implements Callable<Integer> {
        @ParentCommand
        RepositoryPluginCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Parameters(index = "1", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        @Option(names = "--force", description = "Force update when the target plugin version conflicts with installed tool dependency ranges.")
        boolean force;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without updating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.submitRequest(
                    CliRequest.postJson("/api/repositories/" + root.encodePath(repositoryId) + "/plugins/" + root.encodePath(pluginId) + "/update", Map.of(), root.jsonObject(Map.of("force", force))),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock plugins repository update")
            );
        }
    }

    @Command(name = "publish", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Publish an installed plugin into a repository.",
            "Required:",
            "  <repositoryId>",
            "  --file <path|-> repository plugin publish request JSON object.",
            "Examples:",
            "  actiondock plugins repository publish repo-main --file plugin-publish.json",
            "Input JSON shape:",
            "  {\"pluginId\":\"demo-plugin\",\"displayName\":\"Demo Plugin\",\"version\":\"1.0.0\",\"owner\":\"team4u\",\"description\":\"Demo\",\"releaseNotes\":\"Initial release\",\"tags\":[\"demo\"],\"riskLevel\":\"LOW\",\"artifact\":{\"uri\":\"local://plugins/demo.jar\",\"sha256\":\"...\",\"fileName\":\"demo.jar\"}}",
            "Recoverable errors:",
            "  status=2 means invalid CLI input or JSON. status=5 means server validation failed."
    })
    static class PublishRepositoryPlugin implements Callable<Integer> {
        @ParentCommand
        RepositoryPluginCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Option(names = "--file", required = true, description = "Path to the publish request JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without publishing.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            String body = JsonInputSupport.readRequiredJsonObject(root.output(), root.objectMapper(), filePath, "Repository plugin publish request body");
            return root.submitRequest(
                    CliRequest.postJson("/api/repositories/" + root.encodePath(repositoryId) + "/publish-plugin", Map.of(), body),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock plugins repository publish")
            );
        }
    }

    @Override
    public void run() {
        spec.commandLine().usage(root.services.stdout());
    }

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List installed plugins.")
    static class ListPlugins implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        /**
         * 列出所有已安装的插件。
         */
        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/plugins", Map.of()));
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Get details for a single plugin.")
    static class GetPlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        /**
         * 查询单个插件的详情信息。
         */
        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/plugins/" + parent.root().encodePath(pluginId), Map.of()));
        }
    }

    @Command(name = "install", mixinStandardHelpOptions = true, description = "Upload and install a plugin JAR.")
    static class InstallPlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Option(names = "--jar", required = true, description = "Path to the plugin JAR to install.")
        String jarPath;

        @Option(names = "--dry-run", description = "Validate local input and print the final multipart request preview without installing.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JAR readability without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 上传并安装插件 JAR 包。
         */
        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            byte[] content = JsonInputSupport.readBinaryFile(root.output(), jarPath, "Plugin JAR");
            return root.submitRequest(
                    CliRequest.postMultipart("/api/plugins/install", Map.of(), "file", Path.of(jarPath), content),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock plugins install")
            );
        }
    }

    @Command(name = "upgrade", mixinStandardHelpOptions = true, description = "Upgrade a plugin using a new JAR.")
    static class UpgradePlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "Plugin ID to upgrade.")
        String pluginId;

        @Option(names = "--jar", required = true, description = "Path to the plugin JAR used for the upgrade.")
        String jarPath;

        @Option(names = "--dry-run", description = "Validate local input and print the final multipart request preview without upgrading.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JAR readability without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 使用新的 JAR 包升级指定插件。
         */
        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            byte[] content = JsonInputSupport.readBinaryFile(root.output(), jarPath, "Plugin JAR");
            return root.submitRequest(
                    CliRequest.postMultipart("/api/plugins/" + root.encodePath(pluginId) + "/upgrade", Map.of(), "file", Path.of(jarPath), content),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock plugins upgrade")
            );
        }
    }

    @Command(name = "start", mixinStandardHelpOptions = true, description = "Start a plugin.")
    static class StartPlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without starting.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 启动指定插件。
         */
        @Override
        public Integer call() {
            return parent.root().submitRequest(
                    CliRequest.postJson("/api/plugins/" + parent.root().encodePath(pluginId) + "/start", Map.of(), "{}"),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock plugins start")
            );
        }
    }

    @Command(name = "stop", mixinStandardHelpOptions = true, description = "Stop a plugin.")
    static class StopPlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without stopping.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 停止指定插件。
         */
        @Override
        public Integer call() {
            return parent.root().submitRequest(
                    CliRequest.postJson("/api/plugins/" + parent.root().encodePath(pluginId) + "/stop", Map.of(), "{}"),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock plugins stop")
            );
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete a plugin.")
    static class DeletePlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without deleting.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 删除指定插件。
         */
        @Override
        public Integer call() {
            return parent.root().submitRequest(
                    CliRequest.delete("/api/plugins/" + parent.root().encodePath(pluginId), Map.of()),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock plugins delete")
            );
        }
    }

    @Command(name = "invoke", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Invoke a plugin action.",
            "Required:",
            "  <pluginId> <action>",
            "Input:",
            "  --args <jsonObject> or --args-file <path|->",
            "  --script-input <jsonObject> or --script-input-file <path|->",
            "  --file <path|-> complete plugin invoke request body.",
            "Mutual exclusion:",
            "  --args cannot be combined with --args-file.",
            "  --script-input cannot be combined with --script-input-file.",
            "  --file cannot be combined with split JSON options or --response-view.",
            "Defaults:",
            "  --response-view RESULT",
            "Examples:",
            "  actiondock plugins invoke demo summarize --args '{\"topic\":\"ops\"}' --script-input '{}'",
            "  actiondock plugins invoke demo summarize --file invoke.json",
            "Input JSON shape:",
            "  --file: {\"args\":{\"topic\":\"ops\"},\"scriptInput\":{\"locale\":\"zh-CN\"},\"responseView\":\"RESULT\"}",
            "Output JSON shape:",
            "  {\"status\":0,\"msg\":\"Success\",\"data\":{\"result\":{...}}}",
            "Recoverable errors:",
            "  status=2 means invalid CLI input or JSON. status=5 means plugin/server error."
    })
    static class InvokePlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Spec
        CommandSpec spec;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        @Parameters(index = "1", paramLabel = "<action>", description = "Action name to invoke.")
        String action;

        @Option(names = "--args", description = "Inline action arguments as JSON. The top level must be a JSON object. Mutually exclusive with --args-file.")
        String args;

        @Option(names = "--args-file", description = "Path to the action arguments JSON file. Use - to read from stdin. Mutually exclusive with --args.")
        String argsFile;

        @Option(names = "--script-input", description = "Inline script input context as JSON. The top level must be a JSON object. Mutually exclusive with --script-input-file.")
        String scriptInput;

        @Option(names = "--script-input-file", description = "Path to the script input context JSON file. Use - to read from stdin. Mutually exclusive with --script-input.")
        String scriptInputFile;

        @Option(names = "--file", description = "Path to the complete plugin invoke request body JSON file. Use - to read from stdin. Mutually exclusive with --args, --args-file, --script-input, and --script-input-file.")
        String filePath;

        @Option(names = "--response-view", defaultValue = "RESULT", description = "Response view: ${COMPLETION-CANDIDATES}. RESULT returns the business result, DEBUG returns debug details. Default: ${DEFAULT-VALUE}.")
        ActionDockCommand.ResponseViewOption responseView;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without invoking.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 调用插件的指定动作，传入动作参数和脚本输入上下文。
         */
        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            String body;
            if (hasText(filePath)) {
                if (hasText(args) || hasText(argsFile) || hasText(scriptInput) || hasText(scriptInputFile) || matched("--response-view")) {
                    throw CliException.validation(
                            root.output(),
                            "--file cannot be combined with --args, --args-file, --script-input, --script-input-file, or --response-view",
                            CliErrorDetails.mutuallyExclusive(root.output(), "actiondock plugins invoke", List.of("--file", "--args", "--args-file", "--script-input", "--script-input-file", "--response-view"), List.of(
                                    "actiondock plugins invoke <pluginId> <action> --file request.json",
                                    "actiondock plugins invoke <pluginId> <action> --args '{}' --script-input '{}'"
                            ))
                    );
                }
                body = JsonInputSupport.readRequiredJsonObject(root.output(), root.objectMapper(), filePath, "Plugin invoke request body");
            } else {
                String resolvedArgs = JsonInputSupport.readOptionalJsonObject(root.output(), root.objectMapper(), args, argsFile, "Plugin args");
                String resolvedScriptInput = JsonInputSupport.readOptionalJsonObject(root.output(), root.objectMapper(), scriptInput, scriptInputFile, "Script input");
                body = root.jsonObject(Map.of(
                        "args", JsonInputSupport.readTree(root.objectMapper(), root.output(), resolvedArgs),
                        "scriptInput", JsonInputSupport.readTree(root.objectMapper(), root.output(), resolvedScriptInput),
                        "responseView", responseView.name()
                ));
            }
            return root.submitRequest(
                    CliRequest.postJson("/api/plugins/" + root.encodePath(pluginId) + "/actions/" + root.encodePath(action) + "/invoke", Map.of(), body),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock plugins invoke")
            );
        }

        private boolean hasText(String value) {
            return value != null && !value.isBlank();
        }

        private boolean matched(String optionName) {
            return spec.commandLine().getParseResult().hasMatchedOption(optionName);
        }
    }

    @Command(name = "config", mixinStandardHelpOptions = true, description = "Commands for querying and updating plugin config.", subcommands = {GetPluginConfig.class, SetPluginConfig.class})
    static class PluginConfigCommands implements Runnable {
        @ParentCommand
        PluginsCommands parent;

        @Spec
        CommandSpec spec;

        ActionDockCommand root() {
            return parent.root();
        }

        @Override
        public void run() {
            spec.commandLine().usage(root().services.stdout());
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Get plugin config.")
    static class GetPluginConfig implements Callable<Integer> {
        @ParentCommand
        PluginConfigCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        /**
         * 查询指定插件的配置信息。
         */
        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/plugins/" + parent.root().encodePath(pluginId) + "/config", Map.of()));
        }
    }

    @Command(name = "set", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Update plugin config.",
            "Required:",
            "  <pluginId>",
            "  --file <path|-> plugin config request JSON object.",
            "Examples:",
            "  actiondock plugins config set demo --file plugin-config.json",
            "Input JSON shape:",
            "  {\"config\":{\"apiKey\":\"sk-...\",\"endpoint\":\"https://example.test\"}}",
            "Output JSON shape:",
            "  {\"status\":0,\"msg\":\"Success\",\"data\":{\"config\":{...}}}",
            "Recoverable errors:",
            "  status=2 means invalid CLI input or JSON. status=5 means server validation failed."
    })
    static class SetPluginConfig implements Callable<Integer> {
        @ParentCommand
        PluginConfigCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        @Option(names = "--file", required = true, description = "Path to the plugin config request body JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without updating config.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 更新指定插件的配置，从 JSON 文件读取请求体。
         */
        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Plugin config request body");
            return parent.root().submitRequest(
                    CliRequest.putJson("/api/plugins/" + parent.root().encodePath(pluginId) + "/config", Map.of(), body),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock plugins config set")
            );
        }
    }
}
