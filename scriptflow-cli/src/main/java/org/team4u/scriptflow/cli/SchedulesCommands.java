package org.team4u.scriptflow.cli;

import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.Spec;

import java.util.Map;
import java.util.concurrent.Callable;

@Command(name = "schedules", mixinStandardHelpOptions = true, description = "定时任务的查询和维护命令。", subcommands = {
        SchedulesCommands.ListSchedules.class, SchedulesCommands.GetSchedule.class, SchedulesCommands.CreateSchedule.class, SchedulesCommands.UpdateSchedule.class,
        SchedulesCommands.EnableSchedule.class, SchedulesCommands.DisableSchedule.class, SchedulesCommands.DeleteSchedule.class
})
class SchedulesCommands implements Runnable {
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

    @Command(name = "list", mixinStandardHelpOptions = true, description = "列出定时任务；带 --script-id 时只列出该脚本下的定时任务，不带则列出全部。")
    static class ListSchedules implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Option(names = "--script-id", description = "只列出指定脚本下的定时任务。")
        String scriptId;

        @Override
        public Integer call() {
            if (scriptId != null && !scriptId.isBlank()) {
                return parent.root().emit(parent.root().apiClient().get(
                        "/api/scripts/" + parent.root().encodePath(scriptId) + "/schedules",
                        Map.of()
                ));
            }
            return parent.root().emit(parent.root().apiClient().get("/api/schedules", Map.of()));
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "获取单个定时任务详情。")
    static class GetSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0", paramLabel = "<scheduleId>", description = "定时任务 ID。")
        String scheduleId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/schedules/" + parent.root().encodePath(scheduleId), Map.of()));
        }
    }

    @Command(name = "create", mixinStandardHelpOptions = true, description = {
            "创建定时任务。",
            "--file 必须提供定时任务请求体 JSON；顶层必须是 JSON 对象。",
            "请求体走 /api/schedules，全局创建时必须包含 scriptId；常见字段还有 name、cronExpression、input、enabled。",
            "--file=- 时从 stdin 读取。"
    })
    static class CreateSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Option(names = "--file", required = true, description = "定时任务请求体 JSON 文件路径；传 - 表示从 stdin 读取。")
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "定时任务请求体");
            return parent.root().emit(parent.root().apiClient().postJson("/api/schedules", Map.of(), body));
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = {
            "更新指定定时任务。",
            "--file 必须提供定时任务请求体 JSON；顶层必须是 JSON 对象。",
            "请求体仍需带 scriptId，且服务端不允许借此把定时任务改挂到别的脚本上。",
            "--file=- 时从 stdin 读取。"
    })
    static class UpdateSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0", paramLabel = "<scheduleId>", description = "定时任务 ID。")
        String scheduleId;

        @Option(names = "--file", required = true, description = "定时任务请求体 JSON 文件路径；传 - 表示从 stdin 读取。")
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "定时任务请求体");
            return parent.root().emit(parent.root().apiClient().putJson(
                    "/api/schedules/" + parent.root().encodePath(scheduleId),
                    Map.of(),
                    body
            ));
        }
    }

    @Command(name = "enable", mixinStandardHelpOptions = true, description = "启用指定定时任务。")
    static class EnableSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0", paramLabel = "<scheduleId>", description = "定时任务 ID。")
        String scheduleId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson("/api/schedules/" + parent.root().encodePath(scheduleId) + "/enable", Map.of(), "{}"));
        }
    }

    @Command(name = "disable", mixinStandardHelpOptions = true, description = "停用指定定时任务。")
    static class DisableSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0", paramLabel = "<scheduleId>", description = "定时任务 ID。")
        String scheduleId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson("/api/schedules/" + parent.root().encodePath(scheduleId) + "/disable", Map.of(), "{}"));
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "删除指定定时任务。")
    static class DeleteSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0", paramLabel = "<scheduleId>", description = "定时任务 ID。")
        String scheduleId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/schedules/" + parent.root().encodePath(scheduleId), Map.of()));
        }
    }
}
