package org.team4u.scriptflow.cli;

import org.springframework.stereotype.Component;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.application.ScriptSchemaSupport;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.port.JsonCodec;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
@Command(name = "script", subcommands = {ScriptCommands.ListScripts.class, ScriptCommands.ShowScript.class, ScriptCommands.ShowSchema.class})
public class ScriptCommands implements Runnable {
    @Override
    public void run() {
        System.out.println("Use script list/show/schema");
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

    @Component
    @Command(name = "schema")
    static class ShowSchema implements Runnable {
        private final ScriptApplicationService service;
        private final JsonCodec jsonCodec;
        private final ScriptSchemaSupport scriptSchemaSupport;

        @Option(names = "--id", required = true)
        String id;

        ShowSchema(ScriptApplicationService service, JsonCodec jsonCodec) {
            this.service = service;
            this.jsonCodec = jsonCodec;
            this.scriptSchemaSupport = new ScriptSchemaSupport();
        }

        @Override
        public void run() {
            ScriptDefinition definition = service.get(id);
            ScriptSchemaSupport.SchemaSummary inputSummary = scriptSchemaSupport.summarize(definition.getInputSchema());
            ScriptSchemaSupport.SchemaSummary outputSummary = scriptSchemaSupport.summarize(definition.getOutputSchema());

            Map<String, Object> data = new LinkedHashMap<>();
            if (definition.getInputSchema() != null && !definition.getInputSchema().isEmpty()) {
                data.put("input", inputSummary.fields().stream().map(this::toSchemaFieldMap).toList());
            }

            if (definition.getOutputSchema() != null && !definition.getOutputSchema().isEmpty()) {
                data.put("output", outputSummary.fields().stream().map(this::toSchemaFieldMap).toList());
            }

            System.out.println(jsonCodec.write(data));
        }

        private Map<String, Object> toSchemaFieldMap(ScriptSchemaSupport.SchemaField field) {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("name", field.name());
            value.put("label", field.label());
            value.put("kind", field.kind());
            if (field.required()) {
                value.put("required", true);
            }
            if (field.description() != null && !field.description().isBlank()) {
                value.put("description", field.description());
            }
            if (field.enumValues() != null && !field.enumValues().isEmpty()) {
                value.put("enumValues", field.enumValues());
            }
            if (field.defaultValue() != null) {
                value.put("defaultValue", field.defaultValue());
            }
            if (field.examples() != null && !field.examples().isEmpty()) {
                value.put("examples", field.examples());
            }
            return value;
        }
    }
}
