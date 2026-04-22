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

@Command(name = "executions", mixinStandardHelpOptions = true, description = "执行记录的提交、查询和清理命令。", subcommands = {ExecutionsCommands.SubmitExecution.class, ExecutionsCommands.GetExecution.class, ExecutionsCommands.ListExecutions.class, ExecutionsCommands.DeleteExecution.class, ExecutionsCommands.ClearExecutions.class})
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
            "提交一次脚本执行。",
            "--script-id 指定要执行的当前脚本定义；这里走的是 /api/executions，不要求脚本已发布，因此会使用当前保存内容。",
            "执行入参可通过 --input 或 --input-file 提供，二者只能选其一；顶层必须是 JSON 对象，不传时默认 {}。",
            "--mode=SYNC/ASYNC 控制服务端提交模式；--wait 会在提交后按 executionId 轮询执行状态，直到状态不再是 PENDING/RUNNING 或超时。",
            "--response-view=RESULT 返回业务结果，DEBUG 返回更完整的调试信息。"
    })
    static class SubmitExecution implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Option(names = "--script-id", required = true, description = "要执行的脚本 ID。")
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

    @Command(name = "get", mixinStandardHelpOptions = true, description = "获取单次执行的详情。")
    static class GetExecution implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Parameters(index = "0", paramLabel = "<executionId>", description = "执行记录 ID。")
        String executionId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/executions/" + parent.root().encodePath(executionId), Map.of()));
        }
    }

    @Command(name = "list", mixinStandardHelpOptions = true, description = "列出执行记录；可通过 --script-id 只看某个脚本的执行历史。")
    static class ListExecutions implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Option(names = "--script-id", description = "按脚本 ID 过滤执行记录。")
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

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "删除单条执行记录。")
    static class DeleteExecution implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Parameters(index = "0", paramLabel = "<executionId>", description = "执行记录 ID。")
        String executionId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/executions/" + parent.root().encodePath(executionId), Map.of()));
        }
    }

    @Command(name = "clear", mixinStandardHelpOptions = true, description = "按脚本清空执行记录；服务端要求必须提供 --script-id，不支持不带条件地全量清空。")
    static class ClearExecutions implements Callable<Integer> {
        @ParentCommand
        ExecutionsCommands parent;

        @Option(names = "--script-id", description = "要清理执行记录的脚本 ID；服务端必填。")
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
