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
 * 脚本管理命令组，提供脚本的 CRUD、发布和执行等子命令。
 *
 * @author jay.wu
 */
@Command(name = "scripts", mixinStandardHelpOptions = true, description = "Commands for script drafts, published versions, and execution.", subcommands = {
        ScriptsCommands.ListScripts.class, ScriptsCommands.GetScript.class, ScriptsCommands.GetPublishedScript.class, ScriptsCommands.GetScriptSchema.class,
        ScriptsCommands.CreateScript.class, ScriptsCommands.UpdateScript.class, ScriptsCommands.DeleteScript.class, ScriptsCommands.ValidateScript.class,
        ScriptsCommands.PublishScript.class, ScriptsCommands.DiscardDraftScript.class, ScriptsCommands.ExecutePublishedScript.class,
        ScriptsCommands.ForkScript.class, ScriptsCommands.GetDevelopmentStatus.class, ScriptsCommands.PullDevelopmentScript.class
})
class ScriptsCommands implements Runnable {
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

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List script drafts. Requests include includeUiSchema=true.")
    static class ListScripts implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        /**
         * 列出所有脚本草稿，包含 UI Schema 信息。
         */
        @Override
        public Integer call() {
            ActionDockApiClient client = parent.root().apiClient();
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(client.get("/api/scripts", query));
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Get the current saved definition for a script. If unpublished changes exist, this returns the current draft. Requests include includeUiSchema=true.")
    static class GetScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Script ID.")
        String scriptId;

        /**
         * 查询脚本的当前保存定义（含未发布草稿），包含 UI Schema 信息。
         */
        @Override
        public Integer call() {
            ActionDockApiClient client = parent.root().apiClient();
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(client.get("/api/scripts/" + parent.root().encodePath(scriptId), query));
        }
    }

    @Command(name = "get-published", mixinStandardHelpOptions = true, description = "Get the current published version of a script. The server returns an error if the script has not been published yet. Requests include includeUiSchema=true.")
    static class GetPublishedScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Script ID.")
        String scriptId;

        /**
         * 查询脚本的当前发布版本定义，包含 UI Schema 信息。
         */
        @Override
        public Integer call() {
            ActionDockApiClient client = parent.root().apiClient();
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(client.get("/api/scripts/" + parent.root().encodePath(scriptId) + "/published", query));
        }
    }

    @Command(name = "schema", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Get the input/output schema summary for the current script definition.",
            "Examples:",
            "  actiondock scripts schema hello",
            "  actiondock scripts schema hello --example",
            "Output JSON shape:",
            "  without --example: {\"status\":0,\"msg\":\"Success\",\"data\":{\"input\":[...],\"output\":[...]}}",
            "  with --example: {\"status\":0,\"msg\":\"Success\",\"data\":{\"inputSchema\":{...},\"inputExample\":{...},\"outputSchema\":{...},\"outputExample\":{...},\"notes\":[...]}}"
    })
    static class GetScriptSchema implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Script ID.")
        String scriptId;

        @Option(names = "--example", description = "Return schema plus generated inputExample and outputExample for agent request construction.")
        boolean example;

        /**
         * 查询脚本的输入/输出 Schema 摘要。
         */
        @Override
        public Integer call() {
            if (example) {
                ActionDockCommand root = parent.root();
                Map<String, Object> query = new LinkedHashMap<>();
                query.put("includeUiSchema", true);
                JsonNode response = root.apiClient().get("/api/scripts/" + root.encodePath(scriptId), query);
                JsonNode data = response.path("data");
                return root.emitLocalSuccess(SchemaExampleSupport.schemaContract(root.objectMapper(), data));
            }
            return parent.root().emit(parent.root().apiClient().get("/api/schema/" + parent.root().encodePath(scriptId), Map.of()));
        }
    }

    @Command(name = "create", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Create a script draft.",
            "Required:",
            "  --file <path|-> script definition JSON object.",
            "Examples:",
            "  actiondock scripts create --file script.json",
            "  cat script.json | actiondock scripts create --file -",
            "Input JSON shape:",
            "  {\"id\":\"hello\",\"name\":\"Hello\",\"type\":\"GROOVY\",\"source\":\"return [ok:true]\",\"inputSchema\":{\"type\":\"object\",\"properties\":{}},\"outputSchema\":{\"type\":\"object\",\"properties\":{}}}",
            "Output JSON shape:",
            "  {\"status\":0,\"msg\":\"Success\",\"data\":{\"id\":\"hello\",...}}",
            "Recoverable errors:",
            "  status=2 means --file is missing, unreadable, invalid JSON, or not a JSON object."
    })
    static class CreateScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Option(names = "--file", required = true, description = "Path to the script definition JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without creating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 从 JSON 文件创建新的脚本草稿，包含 UI Schema 信息。
         */
        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Script definition");
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().submitRequest(
                    CliRequest.postJson("/api/scripts", query, body),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock scripts create")
            );
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Update the draft definition of a script.",
            "Required:",
            "  <scriptId>",
            "  --file <path|-> full script definition JSON object.",
            "Examples:",
            "  actiondock scripts update hello --file script.json",
            "Input JSON shape:",
            "  {\"id\":\"hello\",\"name\":\"Hello\",\"type\":\"GROOVY\",\"source\":\"return [ok:true]\",\"inputSchema\":{\"type\":\"object\",\"properties\":{}},\"outputSchema\":{\"type\":\"object\",\"properties\":{}}}",
            "Recoverable errors:",
            "  status=2 means arguments or JSON are invalid. status=5 means the server rejected the script definition."
    })
    static class UpdateScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Script ID.")
        String scriptId;

        @Option(names = "--file", required = true, description = "Path to the script definition JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without updating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 更新脚本草稿定义，包含 UI Schema 信息。
         */
        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Script definition");
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().submitRequest(
                    CliRequest.putJson("/api/scripts/" + parent.root().encodePath(scriptId), query, body),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock scripts update")
            );
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete a script.")
    static class DeleteScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Script ID.")
        String scriptId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without deleting.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 删除指定脚本。
         */
        @Override
        public Integer call() {
            return parent.root().submitRequest(
                    CliRequest.delete("/api/scripts/" + parent.root().encodePath(scriptId), Map.of()),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock scripts delete")
            );
        }
    }

    @Command(name = "validate", mixinStandardHelpOptions = true, description = "Validate whether the current saved definition of a script is executable. This does not publish the script.")
    static class ValidateScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Script ID.")
        String scriptId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without validating on the server.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 校验脚本的当前保存定义是否可执行，不触发发布。
         */
        @Override
        public Integer call() {
            return parent.root().submitRequest(
                    CliRequest.postJson("/api/scripts/" + parent.root().encodePath(scriptId) + "/validate", Map.of(), "{}"),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock scripts validate")
            );
        }
    }

    @Command(name = "publish", mixinStandardHelpOptions = true, description = {
            "Publish the current saved definition of a script.",
            "The server stores the current definition as the published snapshot and increments the version number.",
            "Requests include includeUiSchema=true."
    })
    static class PublishScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Script ID.")
        String scriptId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without publishing.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 发布脚本的当前保存定义，递增版本号，包含 UI Schema 信息。
         */
        @Override
        public Integer call() {
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().submitRequest(
                    CliRequest.postJson("/api/scripts/" + parent.root().encodePath(scriptId) + "/publish", query, "{}"),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock scripts publish")
            );
        }
    }

    @Command(name = "discard-draft", mixinStandardHelpOptions = true, description = {
            "Discard unpublished changes for a script and restore the published snapshot.",
            "This command requires the script to already have a published version; otherwise the server returns an error.",
            "Requests include includeUiSchema=true."
    })
    static class DiscardDraftScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Script ID.")
        String scriptId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without discarding.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 丢弃脚本的未发布草稿，恢复为已发布版本快照，包含 UI Schema 信息。
         */
        @Override
        public Integer call() {
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().submitRequest(
                    CliRequest.postJson("/api/scripts/" + parent.root().encodePath(scriptId) + "/discard-draft", query, "{}"),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock scripts discard-draft")
            );
        }
    }

    @Command(name = "execute-published", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Execute the published version of a script and ignore current unpublished changes.",
            "Required:",
            "  <scriptId>",
            "Input:",
            "  --input <jsonObject>",
            "  --input-file <path|->",
            "  --file <path|-> complete published execute request body.",
            "Mutual exclusion:",
            "  --input cannot be combined with --input-file.",
            "  --file cannot be combined with --input, --input-file, --mode, or --response-view.",
            "Defaults:",
            "  --mode SYNC",
            "  --response-view RESULT",
            "  --wait-timeout-seconds 30",
            "  --poll-interval-ms 1000",
            "Examples:",
            "  actiondock scripts execute-published hello --input '{\"name\":\"Alice\"}'",
            "  actiondock scripts execute-published hello --file request.json --wait",
            "Input JSON shape:",
            "  --input / --input-file: {\"name\":\"Alice\"}",
            "  --file: {\"input\":{\"name\":\"Alice\"},\"mode\":\"SYNC\",\"responseView\":\"RESULT\"}",
            "Recoverable errors:",
            "  status=2 means invalid CLI input. status=6 means wait timeout."
    })
    static class ExecutePublishedScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Spec
        CommandSpec spec;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Script ID.")
        String scriptId;

        @Option(names = "--input", description = "Inline execution input JSON. The top level must be a JSON object. Mutually exclusive with --input-file.")
        String input;

        @Option(names = "--input-file", description = "Path to the execution input JSON file. Use - to read from stdin. Mutually exclusive with --input.")
        String inputFile;

        @Option(names = "--file", description = "Path to the complete request body JSON file. Use - to read from stdin. Mutually exclusive with --input and --input-file.")
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

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without executing.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 执行脚本的已发布版本，忽略未发布的草稿变更，可选择等待执行完成。
         */
        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            String body;
            if (JsonInputSupport.hasText(filePath)) {
                if (JsonInputSupport.hasText(input) || JsonInputSupport.hasText(inputFile) || matched("--mode") || matched("--response-view")) {
                    throw CliException.validation(
                            root.output(),
                            "--file cannot be combined with --input, --input-file, --mode, or --response-view",
                            CliErrorDetails.mutuallyExclusive(root.output(), "actiondock scripts execute-published", List.of("--file", "--input", "--input-file", "--mode", "--response-view"), List.of(
                                    "actiondock scripts execute-published <scriptId> --file request.json",
                                    "actiondock scripts execute-published <scriptId> --input '{}'"
                            ))
                    );
                }
                body = JsonInputSupport.readRequiredJsonObject(root.output(), root.objectMapper(), filePath, "Execution request body");
            } else {
                String resolvedInput = JsonInputSupport.readOptionalJsonObject(root.output(), root.objectMapper(), input, inputFile, "Execution input");
                body = root.jsonObject(Map.of(
                        "input", JsonInputSupport.readTree(root.objectMapper(), root.output(), resolvedInput),
                        "mode", mode.name(),
                        "responseView", responseView.name()
                ));
            }
            AgentExecutionOptions options = AgentExecutionOptions.of(dryRun, validateOnly, "actiondock scripts execute-published");
            CliRequest request = CliRequest.postJson("/api/scripts/" + root.encodePath(scriptId) + "/published/execute", Map.of(), body);
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

    @Command(name = "fork", mixinStandardHelpOptions = true, description = {
            "Fork a repository script into a new editable script.",
            "Requests include includeUiSchema=true."
    })
    static class ForkScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Source script ID.")
        String scriptId;

        @Option(names = "--id", required = true, description = "Target script ID.")
        String targetId;

        @Option(names = "--name", required = true, description = "Target script name.")
        String name;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without forking.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return root.submitRequest(
                    CliRequest.postJson("/api/scripts/" + root.encodePath(scriptId) + "/fork", query, root.jsonObject(Map.of("id", targetId, "name", name))),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock scripts fork")
            );
        }
    }

    @Command(name = "development-status", mixinStandardHelpOptions = true, description = "Get repository development sync status for a development script.")
    static class GetDevelopmentStatus implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Development script ID.")
        String scriptId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get(
                    "/api/scripts/" + parent.root().encodePath(scriptId) + "/development-status",
                    Map.of()
            ));
        }
    }

    @Command(name = "development-pull", mixinStandardHelpOptions = true, description = {
            "Pull remote repository updates into a development script.",
            "Requests include includeUiSchema=true. Use --force to pull even when the server reports local conflicts."
    })
    static class PullDevelopmentScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Development script ID.")
        String scriptId;

        @Option(names = "--force", description = "Force pulling remote changes.")
        boolean force;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without pulling.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            query.put("force", force);
            return root.submitRequest(
                    CliRequest.postJson("/api/scripts/" + root.encodePath(scriptId) + "/development-pull", query, "{}"),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock scripts development-pull")
            );
        }
    }
}
