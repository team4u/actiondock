package org.team4u.scriptflow.cli;

import com.fasterxml.jackson.databind.JsonNode;
import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.Spec;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Callable;

@Command(name = "executions", subcommands = {ExecutionsCommands.SubmitExecution.class, ExecutionsCommands.GetExecution.class, ExecutionsCommands.ListExecutions.class, ExecutionsCommands.DeleteExecution.class, ExecutionsCommands.ClearExecutions.class})
class ExecutionsCommands implements Runnable {
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
        ScriptFlowCommand.SubmitModeOption mode;

        @Option(names = "--response-view", defaultValue = "RESULT")
        ScriptFlowCommand.ResponseViewOption responseView;

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
                    "input", JsonInputSupport.readTree(root.objectMapper(), root.output(), resolvedInput),
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
}
