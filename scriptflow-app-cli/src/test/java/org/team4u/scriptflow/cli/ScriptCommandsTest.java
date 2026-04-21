package org.team4u.scriptflow.cli;

import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptStatus;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ScriptCommandsTest {
    @Test
    void listScriptsPrintsTabSeparatedRows() {
        ScriptApplicationService service = mock(ScriptApplicationService.class);
        when(service.list()).thenReturn(List.of(new ScriptDefinition()
                .setId("script-1")
                .setName("Hello")
                .setStatus(ScriptStatus.PUBLISHED)
                .setUpdatedAt(LocalDateTime.of(2024, 1, 2, 3, 4))));
        ScriptCommands.ListScripts command = new ScriptCommands.ListScripts(service);

        String output = captureOutput(command::run);

        assertThat(output).contains("script-1\tHello\tPUBLISHED\t2024-01-02T03:04");
    }

    @Test
    void showScriptPrintsScriptDetails() {
        ScriptApplicationService service = mock(ScriptApplicationService.class);
        when(service.get("script-1")).thenReturn(new ScriptDefinition()
                .setId("script-1")
                .setName("Hello")
                .setStatus(ScriptStatus.DRAFT)
                .setSource("return [:]"));
        ScriptCommands.ShowScript command = new ScriptCommands.ShowScript(service);
        command.id = "script-1";

        String output = captureOutput(command::run);

        assertThat(output).contains("script-1", "Hello", "DRAFT", "return [:]");
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
