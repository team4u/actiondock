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

@Command(name = "scripts", subcommands = {
        ScriptsCommands.ListScripts.class, ScriptsCommands.GetScript.class, ScriptsCommands.GetPublishedScript.class, ScriptsCommands.GetScriptSchema.class,
        ScriptsCommands.CreateScript.class, ScriptsCommands.UpdateScript.class, ScriptsCommands.DeleteScript.class, ScriptsCommands.ValidateScript.class,
        ScriptsCommands.PublishScript.class, ScriptsCommands.DiscardDraftScript.class, ScriptsCommands.ExecutePublishedScript.class
})
class ScriptsCommands implements Runnable {
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
    static class ListScripts implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Override
        public Integer call() {
            ScriptFlowApiClient client = parent.root().apiClient();
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(client.get("/api/scripts", query));
        }
    }

    @Command(name = "get")
    static class GetScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

        @Override
        public Integer call() {
            ScriptFlowApiClient client = parent.root().apiClient();
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(client.get("/api/scripts/" + parent.root().encodePath(scriptId), query));
        }
    }

    @Command(name = "get-published")
    static class GetPublishedScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

        @Override
        public Integer call() {
            ScriptFlowApiClient client = parent.root().apiClient();
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(client.get("/api/scripts/" + parent.root().encodePath(scriptId) + "/published", query));
        }
    }

    @Command(name = "schema")
    static class GetScriptSchema implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/schema/" + parent.root().encodePath(scriptId), Map.of()));
        }
    }

    @Command(name = "create")
    static class CreateScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Option(names = "--file", required = true)
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "脚本定义");
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(parent.root().apiClient().postJson("/api/scripts", query, body));
        }
    }

    @Command(name = "update")
    static class UpdateScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

        @Option(names = "--file", required = true)
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "脚本定义");
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(parent.root().apiClient().putJson(
                    "/api/scripts/" + parent.root().encodePath(scriptId),
                    query,
                    body
            ));
        }
    }

    @Command(name = "delete")
    static class DeleteScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/scripts/" + parent.root().encodePath(scriptId), Map.of()));
        }
    }

    @Command(name = "validate")
    static class ValidateScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson(
                    "/api/scripts/" + parent.root().encodePath(scriptId) + "/validate",
                    Map.of(),
                    "{}"
            ));
        }
    }

    @Command(name = "publish")
    static class PublishScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

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

    @Command(name = "discard-draft")
    static class DiscardDraftScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
        String scriptId;

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

    @Command(name = "execute-published")
    static class ExecutePublishedScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0")
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
                    "input", JsonInputSupport.readTree(root.objectMapper(), root.output(), resolvedInput),
                    "mode", mode.name(),
                    "responseView", responseView.name()
            ));
            JsonNode response = client.postJson("/api/scripts/" + root.encodePath(scriptId) + "/published/execute", Map.of(), body);
            if (wait) {
                response = root.waitForExecution(client, response, waitTimeoutSeconds, pollIntervalMs);
            }
            return root.emit(response);
        }
    }
}
