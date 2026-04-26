package org.team4u.actiondock.cli;

import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.Spec;

import java.util.Map;
import java.util.concurrent.Callable;

@Command(name = "config-values", mixinStandardHelpOptions = true, description = "Commands for global runtime config values.", subcommands = {
        ConfigValuesCommands.ListConfigValues.class,
        ConfigValuesCommands.GetConfigValue.class,
        ConfigValuesCommands.CreateConfigValue.class,
        ConfigValuesCommands.UpdateConfigValue.class,
        ConfigValuesCommands.DeleteConfigValue.class
})
/**
 * 全局配置值命令组，提供服务端配置值的查询和维护能力。
 *
 * @author jay.wu
 */
class ConfigValuesCommands implements Runnable {
    @ParentCommand
    ActionDockCommand root;

    @Spec
    CommandSpec spec;

    ActionDockCommand root() {
        return root;
    }

    @Override
    public void run() {
        spec.commandLine().usage(root.services.stdout());
    }

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List global config values.")
    static class ListConfigValues implements Callable<Integer> {
        @ParentCommand
        ConfigValuesCommands parent;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/config-values", Map.of()));
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Get a single global config value.")
    static class GetConfigValue implements Callable<Integer> {
        @ParentCommand
        ConfigValuesCommands parent;

        @Parameters(index = "0", paramLabel = "<key>", description = "Config key.")
        String key;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/config-values/" + parent.root().encodePath(key), Map.of()));
        }
    }

    @Command(name = "create", mixinStandardHelpOptions = true, description = {
            "Create a global config value.",
            "--file is required and must provide a JSON object matching the /api/config-values request body.",
            "Use --file=- to read from stdin."
    })
    static class CreateConfigValue implements Callable<Integer> {
        @ParentCommand
        ConfigValuesCommands parent;

        @Option(names = "--file", required = true, description = "Path to the config value request JSON file. Use - to read from stdin.")
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Config value request body");
            return parent.root().emit(parent.root().apiClient().postJson("/api/config-values", Map.of(), body));
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = {
            "Update a global config value.",
            "--file is required and must provide a JSON object matching the /api/config-values/{key} request body.",
            "Use --file=- to read from stdin."
    })
    static class UpdateConfigValue implements Callable<Integer> {
        @ParentCommand
        ConfigValuesCommands parent;

        @Parameters(index = "0", paramLabel = "<key>", description = "Config key.")
        String key;

        @Option(names = "--file", required = true, description = "Path to the config value request JSON file. Use - to read from stdin.")
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Config value request body");
            return parent.root().emit(parent.root().apiClient().putJson(
                    "/api/config-values/" + parent.root().encodePath(key),
                    Map.of(),
                    body
            ));
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete a global config value.")
    static class DeleteConfigValue implements Callable<Integer> {
        @ParentCommand
        ConfigValuesCommands parent;

        @Parameters(index = "0", paramLabel = "<key>", description = "Config key.")
        String key;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/config-values/" + parent.root().encodePath(key), Map.of()));
        }
    }
}
