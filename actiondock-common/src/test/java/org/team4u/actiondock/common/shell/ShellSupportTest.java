package org.team4u.actiondock.common.shell;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ShellSupportTest {
    @TempDir
    Path tempDir;

    private final ShellSupport shell = new ShellSupport();

    @Test
    void execCapturesStdoutAndUsesExplicitCwd() {
        ShellExecutionResult result = shell.exec("pwd && printf hello", new ShellExecutionOptions(
                tempDir,
                Map.of(),
                5,
                1024,
                "sh"
        ));

        assertThat(result.ok()).isTrue();
        assertThat(result.stdout()).contains("hello");
        assertThat(result.cwd()).isEqualTo(tempDir.toAbsolutePath().normalize());
    }

    @Test
    void execRejectsMissingCwd() {
        Path missing = tempDir.resolve("missing");

        assertThatThrownBy(() -> shell.exec("pwd", new ShellExecutionOptions(
                missing,
                Map.of(),
                5,
                1024,
                "sh"
        ))).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("cwd is not a directory");
    }

    @Test
    void execMergesEnvironmentAndReturnsNonZeroExit() {
        ShellExecutionResult result = shell.exec("printf \"$ACTIONDOCK_TEST_VALUE\"; exit 7", new ShellExecutionOptions(
                tempDir,
                Map.of("ACTIONDOCK_TEST_VALUE", "visible"),
                5,
                1024,
                "sh"
        ));

        assertThat(result.ok()).isFalse();
        assertThat(result.exitCode()).isEqualTo(7);
        assertThat(result.stdout()).isEqualTo("visible");
    }

    @Test
    void execTimesOutAndTruncatesOutput() {
        ShellExecutionResult result = shell.exec("yes x", new ShellExecutionOptions(
                tempDir,
                Map.of(),
                1,
                16,
                "sh"
        ));

        assertThat(result.ok()).isFalse();
        assertThat(result.timedOut()).isTrue();
        assertThat(result.stdoutTruncated()).isTrue();
        assertThat(result.stdout().getBytes(StandardCharsets.UTF_8).length).isLessThanOrEqualTo(16);
    }

    @Test
    void execDestroysDescendantProcessesOnTimeout() throws Exception {
        Path marker = tempDir.resolve("child-finished");

        ShellExecutionResult result = shell.exec("(sleep 3; touch " + shell.quote(marker, "sh") + ") & wait", new ShellExecutionOptions(
                tempDir,
                Map.of(),
                1,
                1024,
                "sh"
        ));

        Thread.sleep(3500);

        assertThat(result.ok()).isFalse();
        assertThat(result.timedOut()).isTrue();
        assertThat(marker).doesNotExist();
    }

    @Test
    void quoteAndJoinEscapePosixArguments() {
        String command = shell.join(List.of("printf", "%s", "a b'c"), "sh");
        ShellExecutionResult result = shell.exec(command, new ShellExecutionOptions(
                tempDir,
                Map.of(),
                5,
                1024,
                "sh"
        ));

        assertThat(result.ok()).isTrue();
        assertThat(result.stdout()).isEqualTo("a b'c");
        assertThat(shell.quote("a b'c", "sh")).isEqualTo("'a b'\"'\"'c'");
    }

    @Test
    void joinKeepsSimplePowerShellCommandExecutableAndQuotesArguments() {
        String command = shell.join(
                List.of("agent-browser", "--session", "browser 1", "open", "https://example.test/a b"),
                "powershell"
        );

        assertThat(command)
                .isEqualTo("agent-browser '--session' 'browser 1' 'open' 'https://example.test/a b'");
    }

    @Test
    void joinUsesPowerShellCallOperatorWhenCommandPathNeedsQuoting() {
        String command = shell.join(
                List.of("C:\\Program Files\\Agent Browser\\agent-browser.exe", "open", "it's ok"),
                "powershell"
        );

        assertThat(command)
                .isEqualTo("& 'C:\\Program Files\\Agent Browser\\agent-browser.exe' 'open' 'it''s ok'");
    }

    @Test
    void joinQuotesCmdArgumentsOnlyWhenNeeded() {
        String command = shell.join(
                List.of("agent-browser", "--session", "browser 1", "open", "https://example.test/a b"),
                "cmd"
        );

        assertThat(command)
                .isEqualTo("agent-browser --session \"browser 1\" open \"https://example.test/a b\"");
    }

    @Test
    void powerShellPayloadPrependsUtf8Bootstrap() {
        String payload = shell.shellCommandPayload("powershell", "agent-browser '--session' 'browser 1'");

        assertThat(payload)
                .contains("[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)")
                .contains("[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)")
                .contains("$OutputEncoding = [System.Text.UTF8Encoding]::new($false)")
                .endsWith("; agent-browser '--session' 'browser 1'");
    }
}
