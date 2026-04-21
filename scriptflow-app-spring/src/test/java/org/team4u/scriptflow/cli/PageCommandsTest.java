package org.team4u.scriptflow.cli;

import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.application.PageRuntimeApplicationService;
import org.team4u.scriptflow.domain.port.JsonCodec;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PageCommandsTest {
    @Test
    void schemaCommandPrintsRenderedSchemaJson() {
        PageRuntimeApplicationService service = mock(PageRuntimeApplicationService.class);
        JsonCodec jsonCodec = mock(JsonCodec.class);
        PageCommands.SchemaCommand command = new PageCommands.SchemaCommand(service, jsonCodec);
        command.id = "page-1";

        when(service.schema("page-1")).thenReturn(Map.of("type", "page"));
        when(jsonCodec.write(Map.of("type", "page"))).thenReturn("{\"type\":\"page\"}");

        String output = captureOutput(command::run);

        assertThat(output).isEqualTo("{\"type\":\"page\"}");
    }

    private static String captureOutput(Runnable action) {
        PrintStream original = System.out;
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        try {
            System.setOut(new PrintStream(buffer, true, StandardCharsets.UTF_8));
            action.run();
            return buffer.toString(StandardCharsets.UTF_8).trim();
        } finally {
            System.setOut(original);
        }
    }
}
