package org.team4u.scriptflow.bootstrap;

import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptType;

import java.util.Map;

@Component
public class SampleDataInitializer implements CommandLineRunner {
    private final ScriptApplicationService scriptApplicationService;

    public SampleDataInitializer(ScriptApplicationService scriptApplicationService) {
        this.scriptApplicationService = scriptApplicationService;
    }

    @Override
    public void run(String... args) {
        try {
            scriptApplicationService.get("hello-groovy");
        } catch (IllegalArgumentException ignored) {
            ScriptDefinition script = new ScriptDefinition()
                    .setId("hello-groovy")
                    .setName("Hello Groovy")
                    .setType(ScriptType.GROOVY)
                    .setSource("""
                        def name = input.name ?: "World"
                        return [message: "Hello, " + name + "!", upperName: name.toUpperCase()]
                        """)
                    .setInputSchema(Map.of(
                            "type", "object",
                            "properties", Map.of(
                                    "name", Map.of("type", "string", "title", "Name")
                            )
                    ))
                    .setOutputSchema(Map.of(
                            "type", "object",
                            "properties", Map.of(
                                    "message", Map.of("type", "string", "title", "Message"),
                                    "upperName", Map.of("type", "string", "title", "Upper Name")
                            )
                    ));
            scriptApplicationService.save(script);
            scriptApplicationService.publish("hello-groovy");
        }
    }
}
