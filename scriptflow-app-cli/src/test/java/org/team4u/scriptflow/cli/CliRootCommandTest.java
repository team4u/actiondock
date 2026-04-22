package org.team4u.scriptflow.cli;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class CliRootCommandTest {
    @Test
    void runPrintsAvailableSubcommands() {
        String output = captureOutput(new CliRootCommand()::run);

        assertThat(output).isEqualTo("Use subcommands: script | run | plugin");
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
