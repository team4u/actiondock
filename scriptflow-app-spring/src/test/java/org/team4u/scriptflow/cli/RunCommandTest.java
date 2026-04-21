package org.team4u.scriptflow.cli;

import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.application.ExecutionApplicationService;
import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.ExecutionStatus;
import org.team4u.scriptflow.domain.model.SubmitMode;
import org.team4u.scriptflow.domain.port.JsonCodec;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RunCommandTest {
    @Test
    void runExecutesScriptAndPrintsFallbackMetadataWhenDisplayOutputIsEmpty() {
        ExecutionApplicationService service = mock(ExecutionApplicationService.class);
        JsonCodec jsonCodec = mock(JsonCodec.class);
        RunCommand command = new RunCommand(service, jsonCodec);
        command.id = "script-1";
        command.input = "{\"name\":\"Alice\"}";
        command.async = true;

        when(jsonCodec.readMap(command.input)).thenReturn(Map.of("name", "Alice"));
        when(service.execute(eq("script-1"), any(), eq(SubmitMode.ASYNC))).thenReturn(new ExecutionRecord()
                .setId("exec-1")
                .setStatus(ExecutionStatus.PENDING)
                .setErrorMessage("none"));
        when(jsonCodec.write(any())).thenReturn("{\"executionId\":\"exec-1\"}");

        String output = captureOutput(command::run);

        assertThat(output).isEqualTo("{\"executionId\":\"exec-1\"}");
        verify(service).execute(eq("script-1"), eq(Map.of("name", "Alice")), eq(SubmitMode.ASYNC));
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
