package org.team4u.actiondock.cli;

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

@Command(name = "scripts", mixinStandardHelpOptions = true, description = "Commands for script drafts, published versions, and execution.", subcommands = {
        ScriptsCommands.ListScripts.class, ScriptsCommands.GetScript.class, ScriptsCommands.GetPublishedScript.class, ScriptsCommands.GetScriptSchema.class,
        ScriptsCommands.CreateScript.class, ScriptsCommands.UpdateScript.class, ScriptsCommands.DeleteScript.class, ScriptsCommands.ValidateScript.class,
        ScriptsCommands.PublishScript.class, ScriptsCommands.DiscardDraftScript.class, ScriptsCommands.ExecutePublishedScript.class,
        ScriptsCommands.ForkScript.class, ScriptsCommands.GetDevelopmentStatus.class, ScriptsCommands.PullDevelopmentScript.class
})
/**
 * 脚本管理命令组，提供脚本的 CRUD、发布和执行等子命令。
 *
 * @author jay.wu
 */
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

    @Command(name = "schema", mixinStandardHelpOptions = true, description = "Get the input/output schema summary for the current script definition.")
    static class GetScriptSchema implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Script ID.")
        String scriptId;

        /**
         * 查询脚本的输入/输出 Schema 摘要。
         */
        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/schema/" + parent.root().encodePath(scriptId), Map.of()));
        }
    }

    @Command(name = "create", mixinStandardHelpOptions = true, description = {
            "Create a script draft.",
            "--file is required and must point to a script definition JSON file whose top level is a JSON object.",
            "Use --file=- to read from stdin. Requests include includeUiSchema=true."
    })
    static class CreateScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Option(names = "--file", required = true, description = "Path to the script definition JSON file. Use - to read from stdin.")
        String filePath;

        /**
         * 从 JSON 文件创建新的脚本草稿，包含 UI Schema 信息。
         */
        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Script definition");
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(parent.root().apiClient().postJson("/api/scripts", query, body));
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = {
            "Update the draft definition of a script.",
            "--file is required and must provide the full script definition JSON with a JSON object at the top level.",
            "Use --file=- to read from stdin. Requests include includeUiSchema=true."
    })
    static class UpdateScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Script ID.")
        String scriptId;

        @Option(names = "--file", required = true, description = "Path to the script definition JSON file. Use - to read from stdin.")
        String filePath;

        /**
         * 更新脚本草稿定义，包含 UI Schema 信息。
         */
        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Script definition");
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(parent.root().apiClient().putJson(
                    "/api/scripts/" + parent.root().encodePath(scriptId),
                    query,
                    body
            ));
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete a script.")
    static class DeleteScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Script ID.")
        String scriptId;

        /**
         * 删除指定脚本。
         */
        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/scripts/" + parent.root().encodePath(scriptId), Map.of()));
        }
    }

    @Command(name = "validate", mixinStandardHelpOptions = true, description = "Validate whether the current saved definition of a script is executable. This does not publish the script.")
    static class ValidateScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Script ID.")
        String scriptId;

        /**
         * 校验脚本的当前保存定义是否可执行，不触发发布。
         */
        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson(
                    "/api/scripts/" + parent.root().encodePath(scriptId) + "/validate",
                    Map.of(),
                    "{}"
            ));
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

        /**
         * 发布脚本的当前保存定义，递增版本号，包含 UI Schema 信息。
         */
        @Override
        public Integer call() {
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(parent.root().apiClient().postJson(
                    "/api/scripts/" + parent.root().encodePath(scriptId) + "/publish",
                    query,
                    "{}"
            ));
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

        /**
         * 丢弃脚本的未发布草稿，恢复为已发布版本快照，包含 UI Schema 信息。
         */
        @Override
        public Integer call() {
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(parent.root().apiClient().postJson(
                    "/api/scripts/" + parent.root().encodePath(scriptId) + "/discard-draft",
                    query,
                    "{}"
            ));
        }
    }

    @Command(name = "execute-published", mixinStandardHelpOptions = true, description = {
            "Execute the published version of a script and ignore any current unpublished changes.",
            "Execution input can be provided with --input or --input-file, but not both. The top level must be a JSON object. If omitted, {} is used.",
            "Use --file to provide the complete request body as a JSON object. Use --file=- to read from stdin.",
            "--mode=SYNC/ASYNC controls the server-side submit mode. --wait polls execution status by executionId until it is no longer PENDING/RUNNING or until timeout.",
            "--response-view=RESULT returns the business result. DEBUG returns more detailed debug information."
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

        /**
         * 执行脚本的已发布版本，忽略未发布的草稿变更，可选择等待执行完成。
         */
        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            ActionDockApiClient client = root.apiClient();
            String body;
            if (hasText(filePath)) {
                if (hasText(input) || hasText(inputFile) || matched("--mode") || matched("--response-view")) {
                    throw CliException.validation(root.output(), "--file cannot be combined with --input, --input-file, --mode, or --response-view");
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
            JsonNode response = client.postJson("/api/scripts/" + root.encodePath(scriptId) + "/published/execute", Map.of(), body);
            if (wait) {
                response = root.waitForExecution(client, response, waitTimeoutSeconds, pollIntervalMs);
            }
            return root.emit(response);
        }

        private boolean hasText(String value) {
            return value != null && !value.isBlank();
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

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return root.emit(root.apiClient().postJson(
                    "/api/scripts/" + root.encodePath(scriptId) + "/fork",
                    query,
                    root.jsonObject(Map.of("id", targetId, "name", name))
            ));
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

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            query.put("force", force);
            return root.emit(root.apiClient().postJson(
                    "/api/scripts/" + root.encodePath(scriptId) + "/development-pull",
                    query,
                    "{}"
            ));
        }
    }
}
