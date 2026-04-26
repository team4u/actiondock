package org.team4u.actiondock.cli;

import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.Spec;

import java.util.Map;
import java.util.concurrent.Callable;

@Command(name = "presets", mixinStandardHelpOptions = true, description = "Commands for managing execution parameter presets.", subcommands = {
        PresetsCommands.ListPresets.class, PresetsCommands.CreatePreset.class, PresetsCommands.UpdatePreset.class,
        PresetsCommands.DeletePreset.class
})
/**
 * 执行参数预设命令组，提供预设的查询、创建、更新和删除等子命令。
 *
 * @author jay.wu
 */
class PresetsCommands implements Runnable {
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

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List all presets for a script.")
    static class ListPresets implements Callable<Integer> {
        @ParentCommand
        PresetsCommands parent;

        @Option(names = "--script-id", required = true, description = "Script ID.")
        String scriptId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get(
                    "/api/scripts/" + parent.root().encodePath(scriptId) + "/presets",
                    Map.of()
            ));
        }
    }

    @Command(name = "create", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Create a parameter preset for a script.",
            "Required:",
            "  --script-id <id>",
            "  --file <path|-> preset request JSON object.",
            "Examples:",
            "  actiondock presets create --script-id my-script --file preset.json",
            "  echo '{\"name\":\"my-preset\",\"input\":{\"name\":\"World\"}}' | actiondock presets create --script-id my-script --file -",
            "Input JSON shape:",
            "  {\"name\":\"my-preset\",\"input\":{\"name\":\"World\"}}",
            "Output JSON shape:",
            "  {\"status\":0,\"msg\":\"Success\",\"data\":{\"id\":\"...\",\"scriptId\":\"...\",\"name\":\"my-preset\",\"input\":{...},...}}",
            "Recoverable errors:",
            "  status=2 means invalid CLI input or JSON. status=5 means server validation failed."
    })
    static class CreatePreset implements Callable<Integer> {
        @ParentCommand
        PresetsCommands parent;

        @Option(names = "--script-id", required = true, description = "Script ID.")
        String scriptId;

        @Option(names = "--file", required = true, description = "Path to the preset request body JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without creating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Preset request body");
            return parent.root().submitRequest(
                    CliRequest.postJson("/api/scripts/" + parent.root().encodePath(scriptId) + "/presets", Map.of(), body),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock presets create")
            );
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Update a parameter preset.",
            "Required:",
            "  <presetId>",
            "  --script-id <id>",
            "  --file <path|-> preset request JSON object.",
            "Examples:",
            "  actiondock presets update --script-id my-script preset-123 --file preset.json",
            "Input JSON shape:",
            "  {\"name\":\"renamed\",\"input\":{\"name\":\"Alice\"}}",
            "Recoverable errors:",
            "  status=2 means invalid CLI input or JSON. status=5 means the server rejected the update."
    })
    static class UpdatePreset implements Callable<Integer> {
        @ParentCommand
        PresetsCommands parent;

        @Parameters(index = "0", paramLabel = "<presetId>", description = "Preset ID.")
        String presetId;

        @Option(names = "--script-id", required = true, description = "Script ID.")
        String scriptId;

        @Option(names = "--file", required = true, description = "Path to the preset request body JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without updating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Preset request body");
            return parent.root().submitRequest(
                    CliRequest.putJson("/api/scripts/" + parent.root().encodePath(scriptId) + "/presets/" + parent.root().encodePath(presetId), Map.of(), body),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock presets update")
            );
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete a parameter preset.")
    static class DeletePreset implements Callable<Integer> {
        @ParentCommand
        PresetsCommands parent;

        @Parameters(index = "0", paramLabel = "<presetId>", description = "Preset ID.")
        String presetId;

        @Option(names = "--script-id", required = true, description = "Script ID.")
        String scriptId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without deleting.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return parent.root().submitRequest(
                    CliRequest.delete("/api/scripts/" + parent.root().encodePath(scriptId) + "/presets/" + parent.root().encodePath(presetId), Map.of()),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock presets delete")
            );
        }
    }
}
