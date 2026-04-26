package org.team4u.actiondock.cli;

import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.Spec;

import java.util.Map;
import java.util.concurrent.Callable;

/**
 * 定时调度命令组，提供调度的查询、创建、启停和删除等子命令。
 *
 * @author jay.wu
 */
@Command(name = "schedules", mixinStandardHelpOptions = true, description = "Commands for querying and maintaining schedules.", subcommands = {
        SchedulesCommands.ListSchedules.class, SchedulesCommands.GetSchedule.class, SchedulesCommands.CreateSchedule.class, SchedulesCommands.UpdateSchedule.class,
        SchedulesCommands.EnableSchedule.class, SchedulesCommands.DisableSchedule.class, SchedulesCommands.DeleteSchedule.class
})
class SchedulesCommands implements Runnable {
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

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List schedules. With --script-id, only schedules for that script are returned; without it, all schedules are listed.")
    static class ListSchedules implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Option(names = "--script-id", description = "Only list schedules for the specified script.")
        String scriptId;

        /**
         * 列出调度列表，支持按脚本 ID 过滤。
         */
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

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Get details for a single schedule.")
    static class GetSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0", paramLabel = "<scheduleId>", description = "Schedule ID.")
        String scheduleId;

        /**
         * 查询单个调度的详情信息。
         */
        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/schedules/" + parent.root().encodePath(scheduleId), Map.of()));
        }
    }

    @Command(name = "create", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Create a schedule.",
            "Required:",
            "  --file <path|-> schedule request JSON object.",
            "Examples:",
            "  actiondock schedules create --file schedule.json",
            "Input JSON shape:",
            "  {\"scriptId\":\"hello\",\"name\":\"Daily hello\",\"cronExpression\":\"0 0 9 * * *\",\"input\":{\"name\":\"Alice\"},\"enabled\":true}",
            "Output JSON shape:",
            "  {\"status\":0,\"msg\":\"Success\",\"data\":{\"id\":\"...\",...}}",
            "Recoverable errors:",
            "  status=2 means invalid CLI input or JSON. status=5 means server validation failed."
    })
    static class CreateSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Option(names = "--file", required = true, description = "Path to the schedule request body JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without creating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 从 JSON 文件创建新的调度规则。
         */
        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Schedule request body");
            return parent.root().submitRequest(
                    CliRequest.postJson("/api/schedules", Map.of(), body),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock schedules create")
            );
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Update a schedule.",
            "Required:",
            "  <scheduleId>",
            "  --file <path|-> schedule request JSON object.",
            "Examples:",
            "  actiondock schedules update schedule-1 --file schedule.json",
            "Input JSON shape:",
            "  {\"scriptId\":\"hello\",\"name\":\"Daily hello\",\"cronExpression\":\"0 0 9 * * *\",\"input\":{\"name\":\"Alice\"},\"enabled\":true}",
            "Recoverable errors:",
            "  status=2 means invalid CLI input or JSON. status=5 means the server rejected the update.",
            "  The server does not allow moving a schedule to a different script."
    })
    static class UpdateSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0", paramLabel = "<scheduleId>", description = "Schedule ID.")
        String scheduleId;

        @Option(names = "--file", required = true, description = "Path to the schedule request body JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without updating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 从 JSON 文件更新指定调度的配置。
         */
        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Schedule request body");
            return parent.root().submitRequest(
                    CliRequest.putJson("/api/schedules/" + parent.root().encodePath(scheduleId), Map.of(), body),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock schedules update")
            );
        }
    }

    @Command(name = "enable", mixinStandardHelpOptions = true, description = "Enable a schedule.")
    static class EnableSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0", paramLabel = "<scheduleId>", description = "Schedule ID.")
        String scheduleId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without enabling.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 启用指定调度。
         */
        @Override
        public Integer call() {
            return parent.root().submitRequest(
                    CliRequest.postJson("/api/schedules/" + parent.root().encodePath(scheduleId) + "/enable", Map.of(), "{}"),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock schedules enable")
            );
        }
    }

    @Command(name = "disable", mixinStandardHelpOptions = true, description = "Disable a schedule.")
    static class DisableSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0", paramLabel = "<scheduleId>", description = "Schedule ID.")
        String scheduleId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without disabling.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 禁用指定调度。
         */
        @Override
        public Integer call() {
            return parent.root().submitRequest(
                    CliRequest.postJson("/api/schedules/" + parent.root().encodePath(scheduleId) + "/disable", Map.of(), "{}"),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock schedules disable")
            );
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete a schedule.")
    static class DeleteSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0", paramLabel = "<scheduleId>", description = "Schedule ID.")
        String scheduleId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without deleting.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        /**
         * 删除指定调度。
         */
        @Override
        public Integer call() {
            return parent.root().submitRequest(
                    CliRequest.delete("/api/schedules/" + parent.root().encodePath(scheduleId), Map.of()),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock schedules delete")
            );
        }
    }
}
