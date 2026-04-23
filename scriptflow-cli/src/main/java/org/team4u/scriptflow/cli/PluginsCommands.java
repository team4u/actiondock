package org.team4u.scriptflow.cli;

import com.fasterxml.jackson.databind.JsonNode;
import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.Spec;

import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.Callable;

@Command(name = "plugins", mixinStandardHelpOptions = true, description = "Commands for plugin installation, lifecycle operations, invocation, and config.", subcommands = {
        PluginsCommands.ListPlugins.class, PluginsCommands.GetPlugin.class, PluginsCommands.InstallPlugin.class, PluginsCommands.UpgradePlugin.class,
        PluginsCommands.StartPlugin.class, PluginsCommands.StopPlugin.class, PluginsCommands.DeletePlugin.class, PluginsCommands.InvokePlugin.class, PluginsCommands.PluginConfigCommands.class
})
/**
 * 插件管理命令组，提供插件的安装、启停、调用和配置等子命令。
 *
 * @author jay.wu
 */
class PluginsCommands implements Runnable {
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

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List installed plugins.")
    static class ListPlugins implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

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

        @Override
        public Integer call() {
            ScriptFlowCommand root = parent.root();
            byte[] content = JsonInputSupport.readBinaryFile(root.output(), jarPath, "Plugin JAR");
            return root.emit(root.apiClient().postMultipart("/api/plugins/install", Map.of(), "file", Path.of(jarPath), content));
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

        @Override
        public Integer call() {
            ScriptFlowCommand root = parent.root();
            byte[] content = JsonInputSupport.readBinaryFile(root.output(), jarPath, "Plugin JAR");
            return root.emit(root.apiClient().postMultipart(
                    "/api/plugins/" + root.encodePath(pluginId) + "/upgrade",
                    Map.of(),
                    "file",
                    Path.of(jarPath),
                    content
            ));
        }
    }

    @Command(name = "start", mixinStandardHelpOptions = true, description = "Start a plugin.")
    static class StartPlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson("/api/plugins/" + parent.root().encodePath(pluginId) + "/start", Map.of(), "{}"));
        }
    }

    @Command(name = "stop", mixinStandardHelpOptions = true, description = "Stop a plugin.")
    static class StopPlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson("/api/plugins/" + parent.root().encodePath(pluginId) + "/stop", Map.of(), "{}"));
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete a plugin.")
    static class DeletePlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/plugins/" + parent.root().encodePath(pluginId), Map.of()));
        }
    }

    @Command(name = "invoke", mixinStandardHelpOptions = true, description = {
            "Invoke a plugin action.",
            "The action name comes from the path parameter. --args provides action-specific arguments and --script-input provides the script input context passed to the plugin. They map to PluginInvokeRequest.args and PluginInvokeRequest.scriptInput on the server.",
            "--args/--args-file and --script-input/--script-input-file are mutually exclusive pairs. Each value must be a JSON object at the top level. If omitted, {} is used.",
            "--response-view=RESULT returns only the result. DEBUG additionally returns a debug block containing the raw args and scriptInput."
    })
    static class InvokePlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

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

        @Option(names = "--response-view", defaultValue = "RESULT", description = "Response view: ${COMPLETION-CANDIDATES}. RESULT returns the business result, DEBUG returns debug details. Default: ${DEFAULT-VALUE}.")
        ScriptFlowCommand.ResponseViewOption responseView;

        @Override
        public Integer call() {
            ScriptFlowCommand root = parent.root();
            String resolvedArgs = JsonInputSupport.readOptionalJsonObject(root.output(), root.objectMapper(), args, argsFile, "Plugin args");
            String resolvedScriptInput = JsonInputSupport.readOptionalJsonObject(root.output(), root.objectMapper(), scriptInput, scriptInputFile, "Script input");
            String body = root.jsonObject(Map.of(
                    "args", JsonInputSupport.readTree(root.objectMapper(), root.output(), resolvedArgs),
                    "scriptInput", JsonInputSupport.readTree(root.objectMapper(), root.output(), resolvedScriptInput),
                    "responseView", responseView.name()
            ));
            return root.emit(root.apiClient().postJson(
                    "/api/plugins/" + root.encodePath(pluginId) + "/actions/" + root.encodePath(action) + "/invoke",
                    Map.of(),
                    body
            ));
        }
    }

    @Command(name = "config", mixinStandardHelpOptions = true, description = "Commands for querying and updating plugin config.", subcommands = {GetPluginConfig.class, SetPluginConfig.class})
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

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Get plugin config.")
    static class GetPluginConfig implements Callable<Integer> {
        @ParentCommand
        PluginConfigCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/plugins/" + parent.root().encodePath(pluginId) + "/config", Map.of()));
        }
    }

    @Command(name = "set", mixinStandardHelpOptions = true, description = {
            "Update plugin config.",
            "--file is required and must provide a plugin config request body whose top level is a JSON object.",
            "The payload must match the /api/plugins/{pluginId}/config contract, which means the top level contains a config field, for example {\"config\":{...}}.",
            "Use --file=- to read from stdin."
    })
    static class SetPluginConfig implements Callable<Integer> {
        @ParentCommand
        PluginConfigCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        @Option(names = "--file", required = true, description = "Path to the plugin config request body JSON file. Use - to read from stdin.")
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Plugin config request body");
            return parent.root().emit(parent.root().apiClient().putJson(
                    "/api/plugins/" + parent.root().encodePath(pluginId) + "/config",
                    Map.of(),
                    body
            ));
        }
    }
}
