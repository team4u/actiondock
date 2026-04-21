package org.team4u.scriptflow.cli;

import org.springframework.stereotype.Component;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

@Component
@Command(name = "script", subcommands = {ScriptCommands.ListScripts.class, ScriptCommands.ShowScript.class})
public class ScriptCommands implements Runnable {
    @Override
    public void run() {
        System.out.println("Use script list/show");
    }

    @Component
    @Command(name = "list")
    static class ListScripts implements Runnable {
        private final ScriptApplicationService service;

        ListScripts(ScriptApplicationService service) {
            this.service = service;
        }

        @Override
        public void run() {
            for (ScriptDefinition definition : service.list()) {
                System.out.printf("%s\t%s\t%s\t%s%n",
                        definition.getId(),
                        definition.getName(),
                        definition.getStatus(),
                        definition.getUpdatedAt());
            }
        }
    }

    @Component
    @Command(name = "show")
    static class ShowScript implements Runnable {
        private final ScriptApplicationService service;

        @Option(names = "--id", required = true)
        String id;

        ShowScript(ScriptApplicationService service) {
            this.service = service;
        }

        @Override
        public void run() {
            ScriptDefinition definition = service.get(id);
            System.out.println(definition.getId());
            System.out.println(definition.getName());
            System.out.println(definition.getStatus());
            System.out.println(definition.getSource());
        }
    }
}
