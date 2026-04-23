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

@Command(name = "scripts", mixinStandardHelpOptions = true, description = "脚本草稿、发布版本和执行相关命令。", subcommands = {
        ScriptsCommands.ListScripts.class, ScriptsCommands.GetScript.class, ScriptsCommands.GetPublishedScript.class, ScriptsCommands.GetScriptSchema.class,
        ScriptsCommands.CreateScript.class, ScriptsCommands.UpdateScript.class, ScriptsCommands.DeleteScript.class, ScriptsCommands.ValidateScript.class,
        ScriptsCommands.PublishScript.class, ScriptsCommands.DiscardDraftScript.class, ScriptsCommands.ExecutePublishedScript.class
})
/**
 * 脚本管理命令组，提供脚本的 CRUD、发布和执行等子命令。
 *
 * @author jay.wu
 */
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

    @Command(name = "list", mixinStandardHelpOptions = true, description = "列出脚本草稿列表；请求会附带 includeUiSchema=true。")
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

    @Command(name = "get", mixinStandardHelpOptions = true, description = "获取指定脚本当前保存的定义；如果脚本已有未发布修改，这里返回的是当前草稿内容；请求会附带 includeUiSchema=true。")
    static class GetScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "脚本 ID。")
        String scriptId;

        @Override
        public Integer call() {
            ScriptFlowApiClient client = parent.root().apiClient();
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(client.get("/api/scripts/" + parent.root().encodePath(scriptId), query));
        }
    }

    @Command(name = "get-published", mixinStandardHelpOptions = true, description = "获取指定脚本当前已发布版本的详情；如果脚本尚未发布，服务端会报错；请求会附带 includeUiSchema=true。")
    static class GetPublishedScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "脚本 ID。")
        String scriptId;

        @Override
        public Integer call() {
            ScriptFlowApiClient client = parent.root().apiClient();
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(client.get("/api/scripts/" + parent.root().encodePath(scriptId) + "/published", query));
        }
    }

    @Command(name = "schema", mixinStandardHelpOptions = true, description = "获取指定脚本当前定义中的输入/输出 schema 摘要。")
    static class GetScriptSchema implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "脚本 ID。")
        String scriptId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/schema/" + parent.root().encodePath(scriptId), Map.of()));
        }
    }

    @Command(name = "create", mixinStandardHelpOptions = true, description = {
            "创建脚本草稿。",
            "--file 必须提供脚本定义 JSON 文件；顶层必须是 JSON 对象。",
            "--file=- 时从 stdin 读取；请求会附带 includeUiSchema=true。"
    })
    static class CreateScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Option(names = "--file", required = true, description = "脚本定义 JSON 文件路径；传 - 表示从 stdin 读取。")
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "脚本定义");
            Map<String, Object> query = new LinkedHashMap<>();
            query.put("includeUiSchema", true);
            return parent.root().emit(parent.root().apiClient().postJson("/api/scripts", query, body));
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = {
            "更新指定脚本的草稿定义。",
            "--file 必须提供完整脚本定义 JSON；顶层必须是 JSON 对象。",
            "--file=- 时从 stdin 读取；请求会附带 includeUiSchema=true。"
    })
    static class UpdateScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "脚本 ID。")
        String scriptId;

        @Option(names = "--file", required = true, description = "脚本定义 JSON 文件路径；传 - 表示从 stdin 读取。")
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

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "删除指定脚本。")
    static class DeleteScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "脚本 ID。")
        String scriptId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/scripts/" + parent.root().encodePath(scriptId), Map.of()));
        }
    }

    @Command(name = "validate", mixinStandardHelpOptions = true, description = "校验指定脚本当前保存定义是否可执行，不会发布脚本。")
    static class ValidateScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "脚本 ID。")
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

    @Command(name = "publish", mixinStandardHelpOptions = true, description = {
            "发布指定脚本当前保存的定义。",
            "服务端会把当前定义保存为 published snapshot，并将版本号加 1。",
            "请求会附带 includeUiSchema=true。"
    })
    static class PublishScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "脚本 ID。")
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

    @Command(name = "discard-draft", mixinStandardHelpOptions = true, description = {
            "丢弃指定脚本当前未发布修改，恢复为已发布快照。",
            "该命令要求脚本已经存在已发布版本；否则服务端会报错。",
            "请求会附带 includeUiSchema=true。"
    })
    static class DiscardDraftScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "脚本 ID。")
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

    @Command(name = "execute-published", mixinStandardHelpOptions = true, description = {
            "执行指定脚本的已发布版本，不会使用当前未发布修改。",
            "执行入参可通过 --input 或 --input-file 提供，二者只能选其一；顶层必须是 JSON 对象，不传时默认 {}。",
            "--mode=SYNC/ASYNC 控制服务端提交模式；--wait 会在提交后按 executionId 轮询执行状态，直到状态不再是 PENDING/RUNNING 或超时。",
            "--response-view=RESULT 返回业务结果，DEBUG 返回更完整的调试信息。"
    })
    static class ExecutePublishedScript implements Callable<Integer> {
        @ParentCommand
        ScriptsCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "脚本 ID。")
        String scriptId;

        @Option(names = "--input", description = "内联执行入参 JSON；顶层必须是 JSON 对象，和 --input-file 二选一。")
        String input;

        @Option(names = "--input-file", description = "执行入参 JSON 文件路径；传 - 表示从 stdin 读取，和 --input 二选一。")
        String inputFile;

        @Option(names = "--mode", defaultValue = "SYNC", description = "服务端提交模式：${COMPLETION-CANDIDATES}；默认 ${DEFAULT-VALUE}。")
        ScriptFlowCommand.SubmitModeOption mode;

        @Option(names = "--response-view", defaultValue = "RESULT", description = "返回视图：${COMPLETION-CANDIDATES}；RESULT 返回业务结果，DEBUG 返回调试细节；默认 ${DEFAULT-VALUE}。")
        ScriptFlowCommand.ResponseViewOption responseView;

        @Option(names = "--wait", description = "提交后等待执行结束；会轮询 /api/executions/{id}，而不是改变 --mode。")
        boolean wait;

        @Option(names = "--wait-timeout-seconds", defaultValue = "30", description = "等待执行结束的超时时间，单位秒；仅在 --wait 时生效；默认 ${DEFAULT-VALUE}。")
        long waitTimeoutSeconds;

        @Option(names = "--poll-interval-ms", defaultValue = "1000", description = "轮询 execution 状态的时间间隔，单位毫秒；仅在 --wait 时生效；默认 ${DEFAULT-VALUE}。")
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
