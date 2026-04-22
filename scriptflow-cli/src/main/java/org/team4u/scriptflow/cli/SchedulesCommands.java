package org.team4u.scriptflow.cli;

import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.Spec;

import java.util.Map;
import java.util.concurrent.Callable;

@Command(name = "schedules", subcommands = {
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

    @Command(name = "list")
    static class ListSchedules implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Option(names = "--script-id")
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

    @Command(name = "get")
    static class GetSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0")
        String scheduleId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/schedules/" + parent.root().encodePath(scheduleId), Map.of()));
        }
    }

    @Command(name = "create")
    static class CreateSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Option(names = "--file", required = true)
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "定时任务请求体");
            return parent.root().emit(parent.root().apiClient().postJson("/api/schedules", Map.of(), body));
        }
    }

    @Command(name = "update")
    static class UpdateSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0")
        String scheduleId;

        @Option(names = "--file", required = true)
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

    @Command(name = "enable")
    static class EnableSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0")
        String scheduleId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson("/api/schedules/" + parent.root().encodePath(scheduleId) + "/enable", Map.of(), "{}"));
        }
    }

    @Command(name = "disable")
    static class DisableSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0")
        String scheduleId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson("/api/schedules/" + parent.root().encodePath(scheduleId) + "/disable", Map.of(), "{}"));
        }
    }

    @Command(name = "delete")
    static class DeleteSchedule implements Callable<Integer> {
        @ParentCommand
        SchedulesCommands parent;

        @Parameters(index = "0")
        String scheduleId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/schedules/" + parent.root().encodePath(scheduleId), Map.of()));
        }
    }
}
