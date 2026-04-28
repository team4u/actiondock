package org.team4u.actiondock.cli;

import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.Spec;

import java.util.Map;
import java.util.concurrent.Callable;

/**
 * 全局配置值命令组，提供服务端配置值的查询和维护能力。
 *
 * @author jay.wu
 */
@Command(name = "config-values", mixinStandardHelpOptions = true, description = "Commands for global runtime config values.", subcommands = {
        ConfigValuesCommands.ListConfigValues.class,
        ConfigValuesCommands.GetConfigValue.class,
        ConfigValuesCommands.CreateConfigValue.class,
        ConfigValuesCommands.UpdateConfigValue.class,
        ConfigValuesCommands.CopyLocalOverride.class,
        ConfigValuesCommands.RestoreRepositoryDefault.class,
        ConfigValuesCommands.DeleteConfigValue.class
})
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
            "Purpose:",
            "  Create a global config value.",
            "Required:",
            "  --file <path|-> config value request JSON object.",
            "Examples:",
            "  actiondock config-values create --file value.json",
            "Input JSON shape:",
            "  {\"key\":\"openai.api_key\",\"value\":\"sk-...\",\"description\":\"OpenAI API key\"}",
            "Output JSON shape:",
            "  {\"status\":0,\"msg\":\"Success\",\"data\":{\"key\":\"openai.api_key\",...}}",
            "Recoverable errors:",
            "  status=2 means invalid CLI input or JSON. status=5 means server validation failed."
    })
    static class CreateConfigValue implements Callable<Integer> {
        @ParentCommand
        ConfigValuesCommands parent;

        @Option(names = "--file", required = true, description = "Path to the config value request JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without creating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Config value request body");
            return parent.root().submitRequest(
                    CliRequest.postJson("/api/config-values", Map.of(), body),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock config-values create")
            );
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Update a global config value.",
            "Required:",
            "  <key>",
            "  --file <path|-> config value request JSON object.",
            "Examples:",
            "  actiondock config-values update openai.api_key --file value.json",
            "Input JSON shape:",
            "  {\"key\":\"openai.api_key\",\"value\":\"sk-...\",\"description\":\"OpenAI API key\"}",
            "Recoverable errors:",
            "  status=2 means invalid CLI input or JSON. status=5 means server validation failed."
    })
    static class UpdateConfigValue implements Callable<Integer> {
        @ParentCommand
        ConfigValuesCommands parent;

        @Parameters(index = "0", paramLabel = "<key>", description = "Config key.")
        String key;

        @Option(names = "--file", required = true, description = "Path to the config value request JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without updating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Config value request body");
            return parent.root().submitRequest(
                    CliRequest.putJson("/api/config-values/" + parent.root().encodePath(key), Map.of(), body),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock config-values update")
            );
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete a global config value.")
    static class DeleteConfigValue implements Callable<Integer> {
        @ParentCommand
        ConfigValuesCommands parent;

        @Parameters(index = "0", paramLabel = "<key>", description = "Config key.")
        String key;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without deleting.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return parent.root().submitRequest(
                    CliRequest.delete("/api/config-values/" + parent.root().encodePath(key), Map.of()),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock config-values delete")
            );
        }
    }

    @Command(name = "copy-local-override", mixinStandardHelpOptions = true, description = "Copy a managed config value into a local override.")
    static class CopyLocalOverride implements Callable<Integer> {
        @ParentCommand
        ConfigValuesCommands parent;

        @Parameters(index = "0", paramLabel = "<key>", description = "Config key.")
        String key;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without copying.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.submitRequest(
                    CliRequest.postJson("/api/config-values/" + root.encodePath(key) + "/copy-local-override", Map.of(), "{}"),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock config-values copy-local-override")
            );
        }
    }

    @Command(name = "restore-repository-default", mixinStandardHelpOptions = true, description = "Restore a managed config value back to its repository default.")
    static class RestoreRepositoryDefault implements Callable<Integer> {
        @ParentCommand
        ConfigValuesCommands parent;

        @Parameters(index = "0", paramLabel = "<key>", description = "Config key.")
        String key;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without restoring.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.submitRequest(
                    CliRequest.postJson("/api/config-values/" + root.encodePath(key) + "/restore-repository-default", Map.of(), "{}"),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock config-values restore-repository-default")
            );
        }
    }
}
