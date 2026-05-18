package org.team4u.actiondock.workspace.plugin;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ActionDockWorkspaceSystemPluginTest {
    @TempDir
    Path tempDir;

    @Test
    void listDirectoryReturnsDirectoriesAndFiles() throws Exception {
        Files.createDirectories(tempDir.resolve("dir-a"));
        Files.writeString(tempDir.resolve("file-a.txt"), "hello", StandardCharsets.UTF_8);
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("listDirectory", null, Map.of("path", "."));

        assertThat(result).containsEntry("ok", true);
        assertThat(result).containsEntry("directoryCount", 1);
        assertThat(result).containsEntry("fileCount", 1);
        assertThat((List<Map<String, Object>>) result.get("directories"))
                .extracting(entry -> entry.get("name"))
                .containsExactly("dir-a");
        assertThat((List<Map<String, Object>>) result.get("files"))
                .extracting(entry -> entry.get("name"))
                .containsExactly("file-a.txt");
    }

    @Test
    void viewTextFileSupportsViewRange() throws Exception {
        Files.writeString(tempDir.resolve("notes.txt"), "a\nb\nc\nd\n", StandardCharsets.UTF_8);
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("viewTextFile", null, Map.of(
                "path", "notes.txt",
                "viewRange", "2,3"
        ));

        assertThat(result).containsEntry("ok", true);
        assertThat(result).containsEntry("startLine", 2);
        assertThat(result).containsEntry("endLine", 3);
        assertThat((String) result.get("content")).isEqualTo("2: b\n3: c\n");
    }

    @Test
    void writeTextFileSupportsRangesReplacement() throws Exception {
        Files.writeString(tempDir.resolve("notes.txt"), "a\nb\nc\nd\n", StandardCharsets.UTF_8);
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("writeTextFile", null, Map.of(
                "path", "notes.txt",
                "content", "x\ny",
                "ranges", "2,3"
        ));

        assertThat(result).containsEntry("ok", true);
        assertThat(result).containsEntry("created", false);
        assertThat(result).containsEntry("replacedRange", List.of(2, 3));
        assertThat(Files.readString(tempDir.resolve("notes.txt"), StandardCharsets.UTF_8))
                .isEqualTo("a\nx\ny\nd");
    }

    @Test
    void insertTextFileInsertsAtSpecificLine() throws Exception {
        Files.writeString(tempDir.resolve("notes.txt"), "a\nb\n", StandardCharsets.UTF_8);
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("insertTextFile", null, Map.of(
                "path", "notes.txt",
                "content", "x",
                "lineNumber", 2
        ));

        assertThat(result).containsEntry("ok", true);
        assertThat(result).containsEntry("lineNumber", 2);
        assertThat(Files.readAllLines(tempDir.resolve("notes.txt"), StandardCharsets.UTF_8))
                .containsExactly("a", "x", "b");
    }

    @Test
    void executeShellCommandRespectsAllowedCommands() {
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("executeShellCommand", null, Map.of(
                "command", "pwd",
                "allowedCommands", List.of("ls")
        ));

        assertThat(result).containsEntry("ok", false);
        assertThat(result).containsEntry("error", "Command is not allowed by allowedCommands: pwd");
    }

    @Test
    void executeShellCommandReturnsStdout() {
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(Path.of(".").toAbsolutePath().normalize().toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("executeShellCommand", null, Map.of(
                "command", "printf 'hello'",
                "allowedCommands", List.of("printf")
        ));

        assertThat(result).containsEntry("ok", true);
        assertThat(result).containsEntry("timedOut", false);
        assertThat(result.get("stdout")).isEqualTo("hello");
    }

    @Test
    void getSystemInfoReturnsWorkspaceSystemAndCommandDetails() {
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("getSystemInfo", null, Map.of());

        assertThat(result).containsEntry("ok", true);
        assertThat(result).doesNotContainKey("env");
        assertThat(result.get("pathEntries")).isInstanceOf(List.class);

        @SuppressWarnings("unchecked")
        Map<String, Object> workspace = (Map<String, Object>) result.get("workspace");
        @SuppressWarnings("unchecked")
        Map<String, Object> system = (Map<String, Object>) result.get("system");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> shells = (List<Map<String, Object>>) result.get("shells");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> commands = (List<Map<String, Object>>) result.get("commands");

        assertThat(workspace).containsEntry("resolvedBaseDir", tempDir.toString());
        assertThat(workspace).containsKey("processWorkingDirectory");
        assertThat(system).containsKeys("osName", "osVersion", "osArch", "javaVersion", "javaVendor", "pathSeparator");
        assertThat(shells).isNotEmpty();
        assertThat(commands)
                .extracting(entry -> entry.get("name"))
                .containsExactly("bash", "python", "python3", "node", "npm", "npx", "git", "java", "mvn");
        assertThat(commands)
                .allSatisfy(entry -> assertThat(entry).containsKeys(
                        "name", "source", "available", "resolvedPath", "versionCommand", "versionText", "versionExitCode", "versionTimedOut"
                ));
    }

    @Test
    void getSystemInfoAppendsAdditionalCommandsWithoutOverwritingBuiltins() {
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("getSystemInfo", null, Map.of(
                "additionalCommands", List.of("git", "docker", "custom-tool")
        ));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> commands = (List<Map<String, Object>>) result.get("commands");
        Map<String, Map<String, Object>> byName = new LinkedHashMap<>();
        commands.forEach(entry -> byName.put(String.valueOf(entry.get("name")), entry));

        assertThat(commands)
                .extracting(entry -> entry.get("name"))
                .containsExactly("bash", "python", "python3", "node", "npm", "npx", "git", "java", "mvn", "docker", "custom-tool");
        assertThat(byName.get("git")).containsEntry("source", "builtin");
        assertThat(byName.get("docker")).containsEntry("source", "additional");
        assertThat(byName.get("docker")).containsEntry("versionCommand", null);
        assertThat(byName.get("custom-tool")).containsEntry("versionCommand", null);
    }

    @Test
    void getSystemInfoReportsVersionProbeFailuresPerCommand() {
        Path missingExecutable = tempDir.resolve("missing-npm");
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(
                tempDir.toString(),
                command -> "npm".equals(command) ? missingExecutable : null
        );

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("getSystemInfo", null, Map.of());

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> commands = (List<Map<String, Object>>) result.get("commands");
        Map<String, Map<String, Object>> byName = new LinkedHashMap<>();
        commands.forEach(entry -> byName.put(String.valueOf(entry.get("name")), entry));

        assertThat(result).containsEntry("ok", true);
        assertThat(byName.get("npm"))
                .containsEntry("available", true)
                .containsEntry("resolvedPath", missingExecutable.toString())
                .containsEntry("versionText", null)
                .containsEntry("versionExitCode", null)
                .containsEntry("versionTimedOut", false)
                .containsKey("versionError");
    }

    @Test
    void getSystemInfoReportsRequestedShellPathFirst() {
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("getSystemInfo", null, Map.of(
                "shellPath", "/bin/sh"
        ));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> shells = (List<Map<String, Object>>) result.get("shells");

        assertThat(shells).isNotEmpty();
        assertThat(shells.getFirst()).containsEntry("name", "/bin/sh");
    }

    @Test
    void getSystemInfoReportsMissingPathLikeShellAsUnavailable() {
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());
        String shellPath = tempDir.resolve("missing").resolve("bash.exe").toString();

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("getSystemInfo", null, Map.of(
                "shellPath", shellPath
        ));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> shells = (List<Map<String, Object>>) result.get("shells");

        assertThat(result).containsEntry("ok", true);
        assertThat(shells).isNotEmpty();
        assertThat(shells.getFirst())
                .containsEntry("name", shellPath)
                .containsEntry("available", false)
                .containsEntry("resolvedPath", null);
    }

    @Test
    void getSystemInfoIgnoresInvalidShellPath() {
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());
        String shellPath = "\u0000invalid";

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("getSystemInfo", null, Map.of(
                "shellPath", shellPath
        ));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> shells = (List<Map<String, Object>>) result.get("shells");

        assertThat(result).containsEntry("ok", true);
        assertThat(shells).isNotEmpty();
        assertThat(shells.getFirst())
                .containsEntry("name", shellPath)
                .containsEntry("available", false)
                .containsEntry("resolvedPath", null);
    }
}
