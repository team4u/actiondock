package org.team4u.scriptflow.cli;

import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.Spec;

import java.util.Map;
import java.util.concurrent.Callable;

@Command(name = "schedules", mixinStandardHelpOptions = true, description = "Commands for querying and maintaining schedules.", subcommands = {
        SchedulesCommands.ListSchedules.class, SchedulesCommands.GetSchedule.class, SchedulesCommands.CreateSchedule.class, SchedulesCommands.UpdateSchedule.class,
        SchedulesCommands.EnableSchedule.class, SchedulesCommands.DisableSchedule.class, SchedulesCommands.DeleteSchedule.class
})
/**
 * 定时调度命令组，提供调度的查询、创建、启停和删除等子命令。
 *
 * @author jay.wu
 */
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

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List schedules. With --script-id, only schedules for that script are returned; without it, all schedules are listed.")
    static class ListSchedules implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Option(names = "--script-id", description = "Only list schedules for the specified script.")
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

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Get details for a single schedule.")
    static class GetSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0", paramLabel = "<scheduleId>", description = "Schedule ID.")
        String scheduleId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/schedules/" + parent.root().encodePath(scheduleId), Map.of()));
        }
    }

    @Command(name = "create", mixinStandardHelpOptions = true, description = {
            "Create a schedule.",
            "--file is required and must provide the schedule request body as JSON with a JSON object at the top level.",
            "The request is sent to /api/schedules. Global creation requires scriptId. Common fields include name, cronExpression, input, and enabled.",
            "Use --file=- to read from stdin."
    })
    static class CreateSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Option(names = "--file", required = true, description = "Path to the schedule request body JSON file. Use - to read from stdin.")
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Schedule request body");
            return parent.root().emit(parent.root().apiClient().postJson("/api/schedules", Map.of(), body));
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = {
            "Update a schedule.",
            "--file is required and must provide the schedule request body as JSON with a JSON object at the top level.",
            "The payload must still include scriptId, and the server does not allow moving a schedule to a different script through this request.",
            "Use --file=- to read from stdin."
    })
    static class UpdateSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0", paramLabel = "<scheduleId>", description = "Schedule ID.")
        String scheduleId;

        @Option(names = "--file", required = true, description = "Path to the schedule request body JSON file. Use - to read from stdin.")
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Schedule request body");
            return parent.root().emit(parent.root().apiClient().putJson(
                    "/api/schedules/" + parent.root().encodePath(scheduleId),
                    Map.of(),
                    body
            ));
        }
    }

    @Command(name = "enable", mixinStandardHelpOptions = true, description = "Enable a schedule.")
    static class EnableSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0", paramLabel = "<scheduleId>", description = "Schedule ID.")
        String scheduleId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson("/api/schedules/" + parent.root().encodePath(scheduleId) + "/enable", Map.of(), "{}"));
        }
    }

    @Command(name = "disable", mixinStandardHelpOptions = true, description = "Disable a schedule.")
    static class DisableSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0", paramLabel = "<scheduleId>", description = "Schedule ID.")
        String scheduleId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson("/api/schedules/" + parent.root().encodePath(scheduleId) + "/disable", Map.of(), "{}"));
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete a schedule.")
    static class DeleteSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0", paramLabel = "<scheduleId>", description = "Schedule ID.")
        String scheduleId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/schedules/" + parent.root().encodePath(scheduleId), Map.of()));
        }
    }
}
