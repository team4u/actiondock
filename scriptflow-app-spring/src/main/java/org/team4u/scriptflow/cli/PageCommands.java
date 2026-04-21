package org.team4u.scriptflow.cli;

import org.springframework.stereotype.Component;
import org.team4u.scriptflow.application.PageRuntimeApplicationService;
import org.team4u.scriptflow.domain.port.JsonCodec;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

@Component
@Command(name = "page", subcommands = {PageCommands.SchemaCommand.class})
public class PageCommands implements Runnable {
    @Override
    public void run() {
        System.out.println("Use page schema");
    }

    @Component
    @Command(name = "schema")
    static class SchemaCommand implements Runnable {
        private final PageRuntimeApplicationService service;
        private final JsonCodec jsonCodec;

        @Option(names = "--id", required = true)
        String id;

        SchemaCommand(PageRuntimeApplicationService service, JsonCodec jsonCodec) {
            this.service = service;
            this.jsonCodec = jsonCodec;
        }

        @Override
        public void run() {
            System.out.println(jsonCodec.write(service.schema(id)));
        }
    }
}
