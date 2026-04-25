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

@Command(name = "executions", mixinStandardHelpOptions = true, description = "Commands for submitting, querying, and clearing execution records.", subcommands = {ExecutionsCommands.SubmitExecution.class, ExecutionsCommands.GetExecution.class, ExecutionsCommands.ListExecutions.class, ExecutionsCommands.DeleteExecution.class, ExecutionsCommands.ClearExecutions.class})
/**
 * 执行记录命令组，提供执行提交、查询和清理等子命令。
 *
 * @author jay.wu
 */
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

    @Command(name = "submit", mixinStandardHelpOptions = true, description = {
            "Submit a script execution.",
            "--script-id selects the current saved script definition. This command calls /api/executions, so the script does not need to be published and the current saved content is used.",
            "Execution input can be provided with --input or --input-file, but not both. The top level must be a JSON object. If omitted, {} is used.",
            "--mode=SYNC/ASYNC controls the server-side submit mode. --wait polls execution status by executionId until it is no longer PENDING/RUNNING or until timeout.",
            "--response-view=RESULT returns the business result. DEBUG returns more detailed debug information."
    })
    static class SubmitExecution implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Option(names = "--script-id", required = true, description = "Script ID to execute.")
        String scriptId;

        @Option(names = "--input", description = "Inline execution input JSON. The top level must be a JSON object. Mutually exclusive with --input-file.")
        String input;

        @Option(names = "--input-file", description = "Path to the execution input JSON file. Use - to read from stdin. Mutually exclusive with --input.")
        String inputFile;

        @Option(names = "--mode", defaultValue = "SYNC", description = "Server submit mode: ${COMPLETION-CANDIDATES}. Default: ${DEFAULT-VALUE}.")
        ScriptFlowCommand.SubmitModeOption mode;

        @Option(names = "--response-view", defaultValue = "RESULT", description = "Response view: ${COMPLETION-CANDIDATES}. RESULT returns the business result, DEBUG returns debug details. Default: ${DEFAULT-VALUE}.")
        ScriptFlowCommand.ResponseViewOption responseView;

        @Option(names = "--wait", description = "Wait for execution completion after submission. This polls /api/executions/{id}; it does not change --mode.")
        boolean wait;

        @Option(names = "--wait-timeout-seconds", defaultValue = "30", description = "Timeout for waiting on execution completion, in seconds. Only applies with --wait. Default: ${DEFAULT-VALUE}.")
        long waitTimeoutSeconds;

        @Option(names = "--poll-interval-ms", defaultValue = "1000", description = "Polling interval for execution status, in milliseconds. Only applies with --wait. Default: ${DEFAULT-VALUE}.")
        long pollIntervalMs;

        /**
         * 提交脚本执行请求，可选择等待执行完成后返回结果。
         */
        @Override
        public Integer call() {
            ScriptFlowCommand root = parent.root();
            ScriptFlowApiClient client = root.apiClient();
            String resolvedInput = JsonInputSupport.readOptionalJsonObject(root.output(), root.objectMapper(), input, inputFile, "Execution input");
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

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Get the details of a single execution.")
    static class GetExecution implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Parameters(index = "0", paramLabel = "<executionId>", description = "Execution record ID.")
        String executionId;

        /**
         * 查询单条执行记录的详情。
         */
        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/executions/" + parent.root().encodePath(executionId), Map.of()));
        }
    }

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List execution records. Use --script-id to filter by script.")
    static class ListExecutions implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Option(names = "--script-id", description = "Filter execution records by script ID.")
        String scriptId;

        /**
         * 列出执行记录，支持按脚本 ID 过滤。
         */
        @Override
        public Integer call() {
            Map<String, Object> query = new LinkedHashMap<>();
            if (scriptId != null && !scriptId.isBlank()) {
                query.put("scriptId", scriptId);
            }
            return parent.root().emit(parent.root().apiClient().get("/api/executions", query));
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete a single execution record.")
    static class DeleteExecution implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Parameters(index = "0", paramLabel = "<executionId>", description = "Execution record ID.")
        String executionId;

        /**
         * 删除单条执行记录。
         */
        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/executions/" + parent.root().encodePath(executionId), Map.of()));
        }
    }

    @Command(name = "clear", mixinStandardHelpOptions = true, description = "Clear execution records for a script. The server requires --script-id and does not support unconditional full clearing.")
    static class ClearExecutions implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Option(names = "--script-id", description = "Script ID whose execution records should be cleared. Required by the server.")
        String scriptId;

        /**
         * 批量清理指定脚本的执行记录。
         */
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
