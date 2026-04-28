package org.team4u.actiondock.cli;

import com.fasterxml.jackson.databind.JsonNode;
import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.Spec;

import java.util.Map;
import java.util.concurrent.Callable;

@Command(name = "ai", mixinStandardHelpOptions = true, description = "Commands for AI profiles, tools, runs, and workbench operations.", subcommands = {
        AiCommands.ModelCommands.class,
        AiCommands.AgentCommands.class,
        AiCommands.RunCommands.class,
        AiCommands.ToolsetCommands.class,
        AiCommands.ToolCommands.class,
        AiCommands.CallCommands.class,
        AiCommands.WorkbenchCommands.class,
        AiCommands.ChatCommand.class,
        AiCommands.StructuredCommand.class,
        AiCommands.EmbedCommand.class
})
class AiCommands implements Runnable {
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

    @Command(name = "models", mixinStandardHelpOptions = true, description = "Commands for AI model profiles.", subcommands = {
            ListModels.class, GetModel.class, CreateModel.class, UpdateModel.class, DeleteModel.class, TestModel.class
    })
    static class ModelCommands implements Runnable {
        @ParentCommand
        AiCommands parent;

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

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List AI model profiles.")
    static class ListModels implements Callable<Integer> {
        @ParentCommand
        ModelCommands parent;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/ai/models", Map.of()));
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Get a single AI model profile.")
    static class GetModel implements Callable<Integer> {
        @ParentCommand
        ModelCommands parent;

        @Parameters(index = "0", paramLabel = "<modelId>", description = "Model profile ID.")
        String modelId;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.emit(root.apiClient().get("/api/ai/models/" + root.encodePath(modelId), Map.of()));
        }
    }

    @Command(name = "create", mixinStandardHelpOptions = true, description = "Create an AI model profile from a JSON file.")
    static class CreateModel implements Callable<Integer> {
        @ParentCommand
        ModelCommands parent;

        @Option(names = "--file", required = true, description = "Path to the AI model profile JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without creating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return createOrUpdate(parent.root(), "/api/ai/models", filePath, dryRun, validateOnly, "actiondock ai models create", false);
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = "Update an AI model profile from a JSON file.")
    static class UpdateModel implements Callable<Integer> {
        @ParentCommand
        ModelCommands parent;

        @Parameters(index = "0", paramLabel = "<modelId>", description = "Model profile ID.")
        String modelId;

        @Option(names = "--file", required = true, description = "Path to the AI model profile JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without updating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return createOrUpdate(parent.root(), "/api/ai/models/" + parent.root().encodePath(modelId), filePath, dryRun, validateOnly, "actiondock ai models update", true);
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete an AI model profile.")
    static class DeleteModel implements Callable<Integer> {
        @ParentCommand
        ModelCommands parent;

        @Parameters(index = "0", paramLabel = "<modelId>", description = "Model profile ID.")
        String modelId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without deleting.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.submitRequest(
                    CliRequest.delete("/api/ai/models/" + root.encodePath(modelId), Map.of()),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock ai models delete")
            );
        }
    }

    @Command(name = "test", mixinStandardHelpOptions = true, description = "Test an AI model profile with a chat request JSON file.")
    static class TestModel implements Callable<Integer> {
        @ParentCommand
        ModelCommands parent;

        @Parameters(index = "0", paramLabel = "<modelId>", description = "Model profile ID.")
        String modelId;

        @Option(names = "--file", required = true, description = "Path to the AI chat request JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without testing.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return postJsonFile(parent.root(), "/api/ai/models/" + parent.root().encodePath(modelId) + "/test", filePath, dryRun, validateOnly, "actiondock ai models test");
        }
    }

    @Command(name = "agents", mixinStandardHelpOptions = true, description = "Commands for AI agent profiles.", subcommands = {
            ListAgents.class, GetAgent.class, CreateAgent.class, UpdateAgent.class, DeleteAgent.class, TestAgent.class, RunAgent.class
    })
    static class AgentCommands implements Runnable {
        @ParentCommand
        AiCommands parent;

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

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List AI agent profiles.")
    static class ListAgents implements Callable<Integer> {
        @ParentCommand
        AgentCommands parent;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/ai/agents", Map.of()));
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Get a single AI agent profile.")
    static class GetAgent implements Callable<Integer> {
        @ParentCommand
        AgentCommands parent;

        @Parameters(index = "0", paramLabel = "<agentId>", description = "Agent profile ID.")
        String agentId;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.emit(root.apiClient().get("/api/ai/agents/" + root.encodePath(agentId), Map.of()));
        }
    }

    @Command(name = "create", mixinStandardHelpOptions = true, description = "Create an AI agent profile from a JSON file.")
    static class CreateAgent implements Callable<Integer> {
        @ParentCommand
        AgentCommands parent;

        @Option(names = "--file", required = true, description = "Path to the AI agent profile JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without creating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return createOrUpdate(parent.root(), "/api/ai/agents", filePath, dryRun, validateOnly, "actiondock ai agents create", false);
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = "Update an AI agent profile from a JSON file.")
    static class UpdateAgent implements Callable<Integer> {
        @ParentCommand
        AgentCommands parent;

        @Parameters(index = "0", paramLabel = "<agentId>", description = "Agent profile ID.")
        String agentId;

        @Option(names = "--file", required = true, description = "Path to the AI agent profile JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without updating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return createOrUpdate(parent.root(), "/api/ai/agents/" + parent.root().encodePath(agentId), filePath, dryRun, validateOnly, "actiondock ai agents update", true);
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete an AI agent profile.")
    static class DeleteAgent implements Callable<Integer> {
        @ParentCommand
        AgentCommands parent;

        @Parameters(index = "0", paramLabel = "<agentId>", description = "Agent profile ID.")
        String agentId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without deleting.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.submitRequest(
                    CliRequest.delete("/api/ai/agents/" + root.encodePath(agentId), Map.of()),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock ai agents delete")
            );
        }
    }

    @Command(name = "test", mixinStandardHelpOptions = true, description = "Test an AI agent profile with a run request JSON file.")
    static class TestAgent implements Callable<Integer> {
        @ParentCommand
        AgentCommands parent;

        @Parameters(index = "0", paramLabel = "<agentId>", description = "Agent profile ID.")
        String agentId;

        @Option(names = "--file", required = true, description = "Path to the AI agent run request JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without testing.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return postJsonFile(parent.root(), "/api/ai/agents/" + parent.root().encodePath(agentId) + "/test", filePath, dryRun, validateOnly, "actiondock ai agents test");
        }
    }

    @Command(name = "run", mixinStandardHelpOptions = true, description = "Run an AI agent synchronously with a run request JSON file.")
    static class RunAgent implements Callable<Integer> {
        @ParentCommand
        AgentCommands parent;

        @Option(names = "--file", required = true, description = "Path to the AI agent run request JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without running.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return postJsonFile(parent.root(), "/api/ai/agents/run", filePath, dryRun, validateOnly, "actiondock ai agents run");
        }
    }

    @Command(name = "runs", mixinStandardHelpOptions = true, description = "Commands for AI agent run lifecycle management.", subcommands = {
            SubmitRun.class, ListRuns.class, GetRun.class, ResumeRun.class, CancelRun.class
    })
    static class RunCommands implements Runnable {
        @ParentCommand
        AiCommands parent;

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

    @Command(name = "submit", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Submit an AI agent run asynchronously.",
            "Required:",
            "  --file <path|-> agent run request JSON object.",
            "Defaults:",
            "  --wait-timeout-seconds 30",
            "  --poll-interval-ms 1000",
            "Examples:",
            "  actiondock ai runs submit --file run-request.json",
            "  actiondock ai runs submit --file run-request.json --wait",
            "Recoverable errors:",
            "  status=2 means invalid CLI input or JSON. status=6 means wait timeout."
    })
    static class SubmitRun implements Callable<Integer> {
        @ParentCommand
        RunCommands parent;

        @Option(names = "--file", required = true, description = "Path to the AI agent run request JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--wait", description = "Wait until the run leaves RUNNING state by polling /api/ai/agents/runs/{runId}.")
        boolean wait;

        @Option(names = "--wait-timeout-seconds", defaultValue = "30", description = "Timeout for waiting on run completion, in seconds. Only applies with --wait. Default: ${DEFAULT-VALUE}.")
        long waitTimeoutSeconds;

        @Option(names = "--poll-interval-ms", defaultValue = "1000", description = "Polling interval for run status, in milliseconds. Only applies with --wait. Default: ${DEFAULT-VALUE}.")
        long pollIntervalMs;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without submitting.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            String body = JsonInputSupport.readRequiredJsonObject(root.output(), root.objectMapper(), filePath, "AI agent run request body");
            AgentExecutionOptions options = AgentExecutionOptions.of(dryRun, validateOnly, "actiondock ai runs submit");
            CliRequest request = CliRequest.postJson("/api/ai/agents/runs", Map.of(), body);
            if (dryRun || validateOnly) {
                return root.submitRequest(request, options, Map.of("waitRequested", wait));
            }
            JsonNode response = root.executeRequest(request);
            if (wait) {
                response = root.waitForAgentRun(root.apiClient(), response, waitTimeoutSeconds, pollIntervalMs);
            }
            return root.emit(response);
        }
    }

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List AI agent runs.")
    static class ListRuns implements Callable<Integer> {
        @ParentCommand
        RunCommands parent;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/ai/agents/runs", Map.of()));
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Get an AI agent run snapshot.")
    static class GetRun implements Callable<Integer> {
        @ParentCommand
        RunCommands parent;

        @Parameters(index = "0", paramLabel = "<runId>", description = "Run ID.")
        String runId;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.emit(root.apiClient().get("/api/ai/agents/runs/" + root.encodePath(runId), Map.of()));
        }
    }

    @Command(name = "resume", mixinStandardHelpOptions = true, description = "Resume an interrupted or waiting AI agent run.")
    static class ResumeRun implements Callable<Integer> {
        @ParentCommand
        RunCommands parent;

        @Parameters(index = "0", paramLabel = "<runId>", description = "Run ID.")
        String runId;

        @Option(names = "--file", description = "Optional path to the AI agent resume command JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without resuming.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            String body = JsonInputSupport.hasText(filePath)
                    ? JsonInputSupport.readRequiredJsonObject(root.output(), root.objectMapper(), filePath, "AI agent resume request body")
                    : "{}";
            return root.submitRequest(
                    CliRequest.postJson("/api/ai/agents/runs/" + root.encodePath(runId) + "/resume", Map.of(), body),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock ai runs resume")
            );
        }
    }

    @Command(name = "cancel", mixinStandardHelpOptions = true, description = "Cancel an AI agent run.")
    static class CancelRun implements Callable<Integer> {
        @ParentCommand
        RunCommands parent;

        @Parameters(index = "0", paramLabel = "<runId>", description = "Run ID.")
        String runId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without cancelling.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.submitRequest(
                    CliRequest.postJson("/api/ai/agents/runs/" + root.encodePath(runId) + "/cancel", Map.of(), "{}"),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock ai runs cancel")
            );
        }
    }

    @Command(name = "toolsets", mixinStandardHelpOptions = true, description = "Commands for AI toolsets.", subcommands = {
            ListToolsets.class, GetToolset.class, CreateToolset.class, UpdateToolset.class, DeleteToolset.class
    })
    static class ToolsetCommands implements Runnable {
        @ParentCommand
        AiCommands parent;

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

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List AI toolsets.")
    static class ListToolsets implements Callable<Integer> {
        @ParentCommand
        ToolsetCommands parent;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/ai/toolsets", Map.of()));
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Get a single AI toolset.")
    static class GetToolset implements Callable<Integer> {
        @ParentCommand
        ToolsetCommands parent;

        @Parameters(index = "0", paramLabel = "<toolsetId>", description = "Toolset ID.")
        String toolsetId;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.emit(root.apiClient().get("/api/ai/toolsets/" + root.encodePath(toolsetId), Map.of()));
        }
    }

    @Command(name = "create", mixinStandardHelpOptions = true, description = "Create an AI toolset from a JSON file.")
    static class CreateToolset implements Callable<Integer> {
        @ParentCommand
        ToolsetCommands parent;

        @Option(names = "--file", required = true, description = "Path to the AI toolset JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without creating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return createOrUpdate(parent.root(), "/api/ai/toolsets", filePath, dryRun, validateOnly, "actiondock ai toolsets create", false);
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = "Update an AI toolset from a JSON file.")
    static class UpdateToolset implements Callable<Integer> {
        @ParentCommand
        ToolsetCommands parent;

        @Parameters(index = "0", paramLabel = "<toolsetId>", description = "Toolset ID.")
        String toolsetId;

        @Option(names = "--file", required = true, description = "Path to the AI toolset JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without updating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return createOrUpdate(parent.root(), "/api/ai/toolsets/" + parent.root().encodePath(toolsetId), filePath, dryRun, validateOnly, "actiondock ai toolsets update", true);
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete an AI toolset.")
    static class DeleteToolset implements Callable<Integer> {
        @ParentCommand
        ToolsetCommands parent;

        @Parameters(index = "0", paramLabel = "<toolsetId>", description = "Toolset ID.")
        String toolsetId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without deleting.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.submitRequest(
                    CliRequest.delete("/api/ai/toolsets/" + root.encodePath(toolsetId), Map.of()),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock ai toolsets delete")
            );
        }
    }

    @Command(name = "tools", mixinStandardHelpOptions = true, description = "Commands for AI tools.", subcommands = {
            ListTools.class, GetTool.class, TestTool.class
    })
    static class ToolCommands implements Runnable {
        @ParentCommand
        AiCommands parent;

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

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List registered AI tools.")
    static class ListTools implements Callable<Integer> {
        @ParentCommand
        ToolCommands parent;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/ai/tools", Map.of()));
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Get a single AI tool descriptor.")
    static class GetTool implements Callable<Integer> {
        @ParentCommand
        ToolCommands parent;

        @Parameters(index = "0", paramLabel = "<toolName>", description = "Tool name.")
        String toolName;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.emit(root.apiClient().get("/api/ai/tools/" + root.encodePath(toolName), Map.of()));
        }
    }

    @Command(name = "test", mixinStandardHelpOptions = true, description = "Test an AI tool with an input JSON file.")
    static class TestTool implements Callable<Integer> {
        @ParentCommand
        ToolCommands parent;

        @Parameters(index = "0", paramLabel = "<toolName>", description = "Tool name.")
        String toolName;

        @Option(names = "--file", required = true, description = "Path to the AI tool input JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without testing.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return postJsonFile(parent.root(), "/api/ai/tools/" + parent.root().encodePath(toolName) + "/test", filePath, dryRun, validateOnly, "actiondock ai tools test");
        }
    }

    @Command(name = "calls", mixinStandardHelpOptions = true, description = "Commands for AI call logs.", subcommands = {
            ListCalls.class
    })
    static class CallCommands implements Runnable {
        @ParentCommand
        AiCommands parent;

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

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List AI call logs.")
    static class ListCalls implements Callable<Integer> {
        @ParentCommand
        CallCommands parent;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/ai/calls", Map.of()));
        }
    }

    @Command(name = "workbench", mixinStandardHelpOptions = true, description = "Commands for AI workbench tasks.", subcommands = {
            GenerateScript.class, ImproveScript.class, ImproveSchema.class, DiagnoseExecution.class, ReviewPublish.class, ReleaseNotes.class
    })
    static class WorkbenchCommands implements Runnable {
        @ParentCommand
        AiCommands parent;

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

    @Command(name = "generate-script", mixinStandardHelpOptions = true, description = "Generate a script with AI workbench from a JSON file.")
    static class GenerateScript implements Callable<Integer> {
        @ParentCommand
        WorkbenchCommands parent;

        @Option(names = "--file", required = true, description = "Path to the AI workbench command JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without running.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return postJsonFile(parent.root(), "/api/ai/workbench/scripts/generate", filePath, dryRun, validateOnly, "actiondock ai workbench generate-script");
        }
    }

    @Command(name = "improve-script", mixinStandardHelpOptions = true, description = "Improve a script with AI workbench from a JSON file.")
    static class ImproveScript implements Callable<Integer> {
        @ParentCommand
        WorkbenchCommands parent;

        @Option(names = "--file", required = true, description = "Path to the AI workbench command JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without running.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return postJsonFile(parent.root(), "/api/ai/workbench/scripts/improve", filePath, dryRun, validateOnly, "actiondock ai workbench improve-script");
        }
    }

    @Command(name = "improve-schema", mixinStandardHelpOptions = true, description = "Improve a schema with AI workbench from a JSON file.")
    static class ImproveSchema implements Callable<Integer> {
        @ParentCommand
        WorkbenchCommands parent;

        @Option(names = "--file", required = true, description = "Path to the AI workbench command JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without running.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return postJsonFile(parent.root(), "/api/ai/workbench/schemas/improve", filePath, dryRun, validateOnly, "actiondock ai workbench improve-schema");
        }
    }

    @Command(name = "diagnose-execution", mixinStandardHelpOptions = true, description = "Diagnose an execution with AI workbench from a JSON file.")
    static class DiagnoseExecution implements Callable<Integer> {
        @ParentCommand
        WorkbenchCommands parent;

        @Parameters(index = "0", paramLabel = "<executionId>", description = "Execution ID.")
        String executionId;

        @Option(names = "--file", required = true, description = "Path to the AI workbench command JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without running.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return postJsonFile(parent.root(), "/api/ai/workbench/executions/" + parent.root().encodePath(executionId) + "/diagnose", filePath, dryRun, validateOnly, "actiondock ai workbench diagnose-execution");
        }
    }

    @Command(name = "review-publish", mixinStandardHelpOptions = true, description = "Review a script before publish with AI workbench from a JSON file.")
    static class ReviewPublish implements Callable<Integer> {
        @ParentCommand
        WorkbenchCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Script ID.")
        String scriptId;

        @Option(names = "--file", required = true, description = "Path to the AI workbench command JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without running.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return postJsonFile(parent.root(), "/api/ai/workbench/scripts/" + parent.root().encodePath(scriptId) + "/review-publish", filePath, dryRun, validateOnly, "actiondock ai workbench review-publish");
        }
    }

    @Command(name = "release-notes", mixinStandardHelpOptions = true, description = "Generate release notes with AI workbench from a JSON file.")
    static class ReleaseNotes implements Callable<Integer> {
        @ParentCommand
        WorkbenchCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Script ID.")
        String scriptId;

        @Option(names = "--file", required = true, description = "Path to the AI workbench command JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without running.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return postJsonFile(parent.root(), "/api/ai/workbench/scripts/" + parent.root().encodePath(scriptId) + "/release-notes", filePath, dryRun, validateOnly, "actiondock ai workbench release-notes");
        }
    }

    @Command(name = "chat", mixinStandardHelpOptions = true, description = "Run an AI chat request from a JSON file.")
    static class ChatCommand implements Callable<Integer> {
        @ParentCommand
        AiCommands parent;

        @Option(names = "--file", required = true, description = "Path to the AI chat request JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without running.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return postJsonFile(parent.root(), "/api/ai/chat", filePath, dryRun, validateOnly, "actiondock ai chat");
        }
    }

    @Command(name = "structured", mixinStandardHelpOptions = true, description = "Run an AI structured request from a JSON file.")
    static class StructuredCommand implements Callable<Integer> {
        @ParentCommand
        AiCommands parent;

        @Option(names = "--file", required = true, description = "Path to the AI structured request JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without running.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return postJsonFile(parent.root(), "/api/ai/structured", filePath, dryRun, validateOnly, "actiondock ai structured");
        }
    }

    @Command(name = "embed", mixinStandardHelpOptions = true, description = "Run an AI embedding request from a JSON file.")
    static class EmbedCommand implements Callable<Integer> {
        @ParentCommand
        AiCommands parent;

        @Option(names = "--file", required = true, description = "Path to the AI embedding request JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without running.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return postJsonFile(parent.root(), "/api/ai/embed", filePath, dryRun, validateOnly, "actiondock ai embed");
        }
    }

    private static int createOrUpdate(ActionDockCommand root,
                                      String path,
                                      String filePath,
                                      boolean dryRun,
                                      boolean validateOnly,
                                      String command,
                                      boolean update) {
        String body = JsonInputSupport.readRequiredJsonObject(root.output(), root.objectMapper(), filePath, "AI request body");
        CliRequest request = update
                ? CliRequest.putJson(path, Map.of(), body)
                : CliRequest.postJson(path, Map.of(), body);
        return root.submitRequest(request, AgentExecutionOptions.of(dryRun, validateOnly, command));
    }

    private static int postJsonFile(ActionDockCommand root,
                                    String path,
                                    String filePath,
                                    boolean dryRun,
                                    boolean validateOnly,
                                    String command) {
        String body = JsonInputSupport.readRequiredJsonObject(root.output(), root.objectMapper(), filePath, "AI request body");
        return root.submitRequest(
                CliRequest.postJson(path, Map.of(), body),
                AgentExecutionOptions.of(dryRun, validateOnly, command)
        );
    }
}
