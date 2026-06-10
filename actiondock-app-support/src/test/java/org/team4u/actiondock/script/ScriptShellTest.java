package org.team4u.actiondock.script;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ScriptShellTest {
    @TempDir
    Path tempDir;

    @Test
    void execCapturesStdoutAndUsesProcessDirectoryAsDefaultCwd() {
        AppProperties properties = properties();
        ScriptShell shell = new ScriptShell(properties, context("exec-1"));

        Map<String, Object> result = shell.exec("pwd && printf hello", Map.of("shell", "sh"));

        assertThat(result).containsEntry("ok", true);
        assertThat(result.get("stdout").toString()).contains("hello");
        assertThat(result.get("cwd")).isEqualTo(Path.of("").toAbsolutePath().normalize().toString());
        assertThat(Files.exists(tempDir.resolve("runs").resolve("exec-1"))).isFalse();
    }

    @Test
    void execUsesExplicitExistingCwd() throws Exception {
        ScriptShell shell = new ScriptShell(properties(), context("exec-cwd"));
        Path cwd = tempDir.resolve("work");
        Files.createDirectories(cwd);

        Map<String, Object> result = shell.exec("pwd", Map.of("shell", "sh", "cwd", cwd.toString()));

        assertThat(result).containsEntry("ok", true);
        assertThat(result.get("cwd")).isEqualTo(cwd.toString());
    }

    @Test
    void execRejectsMissingExplicitCwd() {
        ScriptShell shell = new ScriptShell(properties(), context("exec-missing-cwd"));
        Path missing = tempDir.resolve("missing");

        assertThatThrownBy(() -> shell.exec("pwd", Map.of("shell", "sh", "cwd", missing.toString())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("cwd is not a directory");
    }

    @Test
    void execMergesEnvironmentAndSupportsCheckFalse() {
        ScriptShell shell = new ScriptShell(properties(), context("exec-env"));

        Map<String, Object> result = shell.exec("printf \"$ACTIONDOCK_TEST_VALUE\"; exit 7", Map.of(
                "shell", "sh",
                "env", Map.of("ACTIONDOCK_TEST_VALUE", "visible"),
                "check", false
        ));

        assertThat(result).containsEntry("ok", false);
        assertThat(result).containsEntry("exitCode", 7);
        assertThat(result.get("stdout")).isEqualTo("visible");
    }

    @Test
    void execThrowsWhenCheckEnabledAndCommandFails() {
        ScriptShell shell = new ScriptShell(properties(), context("exec-check"));

        assertThatThrownBy(() -> shell.exec("exit 9", Map.of("shell", "sh")))
                .isInstanceOf(ShellExecutionException.class)
                .hasMessageContaining("exitCode=9");
    }

    @Test
    void execTimesOutAndTruncatesOutput() {
        ScriptShell shell = new ScriptShell(properties(), context("exec-timeout"));

        Map<String, Object> result = shell.exec("yes x", Map.of(
                "shell", "sh",
                "timeoutSeconds", 1,
                "maxOutputBytes", 16,
                "check", false
        ));

        assertThat(result).containsEntry("ok", false);
        assertThat(result).containsEntry("timedOut", true);
        assertThat(result).containsEntry("stdoutTruncated", true);
        assertThat(result.get("stdout").toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length)
                .isLessThanOrEqualTo(16);
    }

    @Test
    void quoteAndJoinEscapePosixArguments() {
        ScriptShell shell = new ScriptShell(properties(), context("quote"));

        String command = shell.join(List.of("printf", "%s", "a b'c"), Map.of("shell", "sh"));
        Map<String, Object> result = shell.exec(command, Map.of("shell", "sh"));

        assertThat(result).containsEntry("ok", true);
        assertThat(result.get("stdout")).isEqualTo("a b'c");
        assertThat(shell.quote("a b'c", Map.of("shell", "sh"))).isEqualTo("'a b'\"'\"'c'");
    }

    @Test
    void joinKeepsSimplePowerShellCommandExecutableAndQuotesArguments() {
        ScriptShell shell = new ScriptShell(properties(), context("quote-powershell"));

        String command = shell.join(
                List.of("agent-browser", "--session", "browser 1", "open", "https://example.test/a b"),
                Map.of("shell", "powershell")
        );

        assertThat(command)
                .isEqualTo("agent-browser '--session' 'browser 1' 'open' 'https://example.test/a b'");
    }

    @Test
    void joinUsesPowerShellCallOperatorWhenCommandPathNeedsQuoting() {
        ScriptShell shell = new ScriptShell(properties(), context("quote-powershell-path"));

        String command = shell.join(
                List.of("C:\\Program Files\\Agent Browser\\agent-browser.exe", "open", "it's ok"),
                Map.of("shell", "powershell")
        );

        assertThat(command)
                .isEqualTo("& 'C:\\Program Files\\Agent Browser\\agent-browser.exe' 'open' 'it''s ok'");
    }

    @Test
    void joinQuotesCmdArgumentsOnlyWhenNeeded() {
        ScriptShell shell = new ScriptShell(properties(), context("quote-cmd"));

        String command = shell.join(
                List.of("agent-browser", "--session", "browser 1", "open", "https://example.test/a b"),
                Map.of("shell", "cmd")
        );

        assertThat(command)
                .isEqualTo("agent-browser --session \"browser 1\" open \"https://example.test/a b\"");
    }

    @Test
    void powerShellPayloadPrependsUtf8Bootstrap() {
        ScriptShell shell = new ScriptShell(properties(), context("powershell-utf8"));

        String payload = shell.shellCommandPayload("powershell", "agent-browser '--session' 'browser 1'");

        assertThat(payload)
                .contains("[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)")
                .contains("[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)")
                .contains("$OutputEncoding = [System.Text.UTF8Encoding]::new($false)")
                .endsWith("; agent-browser '--session' 'browser 1'");
    }

    private AppProperties properties() {
        AppProperties properties = new AppProperties();
        properties.setHomeDir(tempDir.toString());
        properties.getExecution().setArtifactRootDir(tempDir.resolve("runs").toString());
        properties.getExecution().getShell().setTimeoutSeconds(5);
        properties.getExecution().getShell().setMaxOutputBytes(1024);
        return properties;
    }

    private static ScriptExecutionContext context(String executionId) {
        return new ScriptExecutionContext().setExecutionId(executionId);
    }
}
