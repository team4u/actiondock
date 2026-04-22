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

@Command(name = "plugins", subcommands = {
        PluginsCommands.ListPlugins.class, PluginsCommands.GetPlugin.class, PluginsCommands.InstallPlugin.class, PluginsCommands.UpgradePlugin.class,
        PluginsCommands.StartPlugin.class, PluginsCommands.StopPlugin.class, PluginsCommands.DeletePlugin.class, PluginsCommands.InvokePlugin.class, PluginsCommands.PluginConfigCommands.class
})
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
        ScriptFlowCommand.ResponseViewOption responseView;

        @Override
        public Integer call() {
            ScriptFlowCommand root = parent.root();
            String resolvedArgs = JsonInputSupport.readOptionalJsonObject(root.output(), root.objectMapper(), args, argsFile, "插件参数");
            String resolvedScriptInput = JsonInputSupport.readOptionalJsonObject(root.output(), root.objectMapper(), scriptInput, scriptInputFile, "脚本输入");
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
}
