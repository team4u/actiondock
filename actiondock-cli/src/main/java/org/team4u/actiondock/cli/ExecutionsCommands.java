package org.team4u.actiondock.cli;

import com.fasterxml.jackson.databind.JsonNode;
import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.Spec;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;

/**
 * 执行记录命令组，提供执行提交、查询和清理等子命令。
 *
 * @author jay.wu
 */
@Command(name = "executions", mixinStandardHelpOptions = true, description = "Commands for submitting, querying, and clearing execution records.", subcommands = {ExecutionsCommands.SubmitExecution.class, ExecutionsCommands.GetExecution.class, ExecutionsCommands.ListExecutions.class, ExecutionsCommands.DeleteExecution.class, ExecutionsCommands.ClearExecutions.class})
class ExecutionsCommands implements Runnable {
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

    @Command(name = "submit", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Submit a script execution against the current saved script definition.",
            "Required:",
            "  --script-id <scriptId> unless --file is used.",
            "Input:",
            "  --input <jsonObject>",
            "  --input-file <path|->",
            "  --file <path|-> complete /api/executions request body.",
            "Mutual exclusion:",
            "  --input cannot be combined with --input-file.",
            "  --file cannot be combined with --script-id, --input, --input-file, --mode, or --response-view.",
            "Defaults:",
            "  --mode SYNC",
            "  --response-view RESULT",
            "  --wait-timeout-seconds 30",
            "  --poll-interval-ms 1000",
            "Examples:",
            "  actiondock executions submit --script-id hello --input '{\"name\":\"Alice\"}'",
            "  echo '{\"name\":\"Alice\"}' | actiondock executions submit --script-id hello --input-file -",
            "  actiondock executions submit --file request.json --wait",
            "Input JSON shape:",
            "  --input / --input-file: {\"name\":\"Alice\"}",
            "  --file: {\"scriptId\":\"hello\",\"input\":{\"name\":\"Alice\"},\"mode\":\"SYNC\",\"responseView\":\"RESULT\"}",
            "Output JSON shape:",
            "  {\"status\":0,\"msg\":\"Success\",\"data\":{...}}",
            "Recoverable errors:",
            "  status=2 means invalid CLI input. Fix arguments or JSON and retry.",
            "  status=4 means transport failure. Check base URL, token, and network.",
            "  status=5 means server/business error. Inspect data.",
            "  status=6 means wait timeout. Retry executions get <executionId> or increase --wait-timeout-seconds."
    })
    static class SubmitExecution implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Spec
        CommandSpec spec;

        @Option(names = "--script-id", description = "Script ID to execute. Required unless --file is used.")
        String scriptId;

        @Option(names = "--input", description = "Inline execution input JSON. The top level must be a JSON object. Mutually exclusive with --input-file.")
        String input;

        @Option(names = "--input-file", description = "Path to the execution input JSON file. Use - to read from stdin. Mutually exclusive with --input.")
        String inputFile;

        @Option(names = "--file", description = "Path to the complete /api/executions request body JSON file. Use - to read from stdin. Mutually exclusive with --script-id, --input, and --input-file.")
        String filePath;

        @Option(names = "--mode", defaultValue = "SYNC", description = "Server submit mode: ${COMPLETION-CANDIDATES}. Default: ${DEFAULT-VALUE}.")
        ActionDockCommand.SubmitModeOption mode;

        @Option(names = "--response-view", defaultValue = "RESULT", description = "Response view: ${COMPLETION-CANDIDATES}. RESULT returns the business result, DEBUG returns debug details. Default: ${DEFAULT-VALUE}.")
        ActionDockCommand.ResponseViewOption responseView;

        @Option(names = "--wait", description = "Wait for execution completion after submission. This polls /api/executions/{id}; it does not change --mode.")
        boolean wait;

        @Option(names = "--wait-timeout-seconds", defaultValue = "30", description = "Timeout for waiting on execution completion, in seconds. Only applies with --wait. Default: ${DEFAULT-VALUE}.")
        long waitTimeoutSeconds;

        @Option(names = "--poll-interval-ms", defaultValue = "1000", description = "Polling interval for execution status, in milliseconds. Only applies with --wait. Default: ${DEFAULT-VALUE}.")
        long pollIntervalMs;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without submitting it.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client or submitting.")
        boolean validateOnly;

        /**
         * 提交脚本执行请求，可选择等待执行完成后返回结果。
         */
        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            String body;
            if (JsonInputSupport.hasText(filePath)) {
                if (JsonInputSupport.hasText(scriptId) || JsonInputSupport.hasText(input) || JsonInputSupport.hasText(inputFile) || matched("--mode") || matched("--response-view")) {
                    throw CliException.validation(
                            root.output(),
                            "--file cannot be combined with --script-id, --input, --input-file, --mode, or --response-view",
                            CliErrorDetails.mutuallyExclusive(root.output(), "actiondock executions submit", List.of("--file", "--script-id", "--input", "--input-file", "--mode", "--response-view"), List.of(
                                    "actiondock executions submit --file request.json",
                                    "actiondock executions submit --script-id <scriptId> --input '{}'"
                            ))
                    );
                }
                body = JsonInputSupport.readRequiredJsonObject(root.output(), root.objectMapper(), filePath, "Execution request body");
            } else {
                if (!JsonInputSupport.hasText(scriptId)) {
                    throw CliException.validation(
                            root.output(),
                            "--script-id is required unless --file is used",
                            CliErrorDetails.missingRequired(root.output(), "actiondock executions submit", List.of("--script-id"), List.of("--file"), List.of(
                                    "actiondock executions submit --script-id <scriptId> --input '{}'",
                                    "actiondock executions submit --file request.json"
                            ))
                    );
                }
                String resolvedInput = JsonInputSupport.readOptionalJsonObject(root.output(), root.objectMapper(), input, inputFile, "Execution input");
                body = root.jsonObject(Map.of(
                        "scriptId", scriptId,
                        "input", JsonInputSupport.readTree(root.objectMapper(), root.output(), resolvedInput),
                        "mode", mode.name(),
                        "responseView", responseView.name()
                ));
            }
            AgentExecutionOptions options = AgentExecutionOptions.of(dryRun, validateOnly, "actiondock executions submit");
            CliRequest request = CliRequest.postJson("/api/executions", Map.of(), body);
            if (dryRun || validateOnly) {
                return root.submitRequest(request, options, Map.of("waitRequested", wait));
            }
            JsonNode response = root.executeRequest(request);
            if (wait) {
                response = root.waitForExecution(root.apiClient(), response, waitTimeoutSeconds, pollIntervalMs);
            }
            return root.emit(response);
        }

        private boolean matched(String optionName) {
            return spec.commandLine().getParseResult().hasMatchedOption(optionName);
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

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without deleting.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client or deleting.")
        boolean validateOnly;

        /**
         * 删除单条执行记录。
         */
        @Override
        public Integer call() {
            return parent.root().submitRequest(
                    CliRequest.delete("/api/executions/" + parent.root().encodePath(executionId), Map.of()),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock executions delete")
            );
        }
    }

    @Command(name = "clear", mixinStandardHelpOptions = true, description = "Clear execution records for a script. The server requires --script-id and does not support unconditional full clearing.")
    static class ClearExecutions implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Option(names = "--script-id", required = true, description = "Script ID whose execution records should be cleared. Required by the server.")
        String scriptId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without clearing.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client or clearing.")
        boolean validateOnly;

        /**
         * 批量清理指定脚本的执行记录。
         */
        @Override
        public Integer call() {
            Map<String, Object> query = new LinkedHashMap<>();
            if (scriptId != null && !scriptId.isBlank()) {
                query.put("scriptId", scriptId);
            }
            return parent.root().submitRequest(
                    CliRequest.delete("/api/executions", query),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock executions clear")
            );
        }
    }
}
