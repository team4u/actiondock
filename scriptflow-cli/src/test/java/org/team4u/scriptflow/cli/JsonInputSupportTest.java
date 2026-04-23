package org.team4u.scriptflow.cli;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JsonInputSupportTest {
    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    @TempDir
    Path tempDir;

    @Test
    void readsJsonObjectFromFileAndNormalizesOutput() throws Exception {
        Path jsonFile = tempDir.resolve("payload.json");
        Files.writeString(jsonFile, """
                {
                  "name": "demo",
                  "enabled": true
                }
                """);
        CliOutput output = createOutput();

        String normalized = JsonInputSupport.readRequiredJsonObject(output, objectMapper, jsonFile.toString(), "Request body");

        assertThat(normalized).isEqualTo("{\"name\":\"demo\",\"enabled\":true}");
    }

    @Test
    void readsJsonObjectFromStdinWhenDashIsUsed() {
        CliOutput output = createOutput();
        InputStream originalIn = System.in;
        try {
            System.setIn(new ByteArrayInputStream("{\"name\":\"stdin\"}".getBytes()));
            String normalized = JsonInputSupport.readRequiredJsonObject(output, objectMapper, "-", "Request body");
            assertThat(normalized).isEqualTo("{\"name\":\"stdin\"}");
        } finally {
            System.setIn(originalIn);
        }
    }

    @Test
    void rejectsNonObjectJson() {
        CliOutput output = createOutput();

        assertThatThrownBy(() -> JsonInputSupport.readOptionalJsonObject(output, objectMapper, "[]", null, "Execution input"))
                .isInstanceOf(CliException.class)
                .extracting("exitCode")
                .isEqualTo(CliException.EXIT_VALIDATION);
    }

    private CliOutput createOutput() {
        return new CliOutput(
                objectMapper,
                new java.io.PrintStream(new ByteArrayOutputStream()),
                new java.io.PrintStream(new ByteArrayOutputStream())
        );
    }
}
