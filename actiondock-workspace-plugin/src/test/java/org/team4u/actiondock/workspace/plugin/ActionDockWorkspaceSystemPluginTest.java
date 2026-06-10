package org.team4u.actiondock.workspace.plugin;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
    void findFilesReturnsSortedFilesWithGlobsAndDefaultExcludes() throws Exception {
        Files.createDirectories(tempDir.resolve("src/main"));
        Files.createDirectories(tempDir.resolve("target/classes"));
        Files.writeString(tempDir.resolve("src/main/App.java"), "class App {}", StandardCharsets.UTF_8);
        Files.writeString(tempDir.resolve("src/main/AppTest.java"), "class AppTest {}", StandardCharsets.UTF_8);
        Files.writeString(tempDir.resolve("target/classes/App.class"), "binary", StandardCharsets.UTF_8);
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("findFiles", null, Map.of(
                "path", ".",
                "includeGlobs", List.of("**/*.java"),
                "excludeGlobs", List.of("**/*Test.java")
        ));

        assertThat(result).containsEntry("ok", true);
        assertThat(result).containsEntry("resultCount", 1);
        assertThat((List<Map<String, Object>>) result.get("files"))
                .extracting(entry -> entry.get("relativePath"))
                .containsExactly("src/main/App.java");
        assertThat(result).containsEntry("truncated", false);
    }

    @Test
    void findFilesCanDisableDefaultExcludesAndReturnDirectories() throws Exception {
        Files.createDirectories(tempDir.resolve("target/classes"));
        Files.writeString(tempDir.resolve("target/classes/App.class"), "binary", StandardCharsets.UTF_8);
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("findFiles", null, Map.of(
                "path", ".",
                "fileType", "directory",
                "includeDefaultExcludes", false,
                "includeGlobs", List.of("target/classes")
        ));

        assertThat(result).containsEntry("ok", true);
        assertThat((List<Map<String, Object>>) result.get("files"))
                .extracting(entry -> entry.get("relativePath"))
                .containsExactly("target/classes");
    }

    @Test
    void searchTextDefaultsToRegexAndReturnsMatchCoordinates() throws Exception {
        Files.createDirectories(tempDir.resolve("src"));
        Files.writeString(tempDir.resolve("src/app.txt"), "alpha-123\nbeta-456\n", StandardCharsets.UTF_8);
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("searchText", null, Map.of(
                "query", "[a-z]+-\\d+",
                "path", "src"
        ));

        assertThat(result).containsEntry("ok", true);
        assertThat(result).containsEntry("matchCount", 2);
        assertThat(result).containsEntry("matchedFileCount", 1);
        assertThat((List<Map<String, Object>>) result.get("matches"))
                .extracting(entry -> entry.get("matchText"))
                .containsExactly("alpha-123", "beta-456");
        assertThat(((List<Map<String, Object>>) result.get("matches")).getFirst())
                .containsEntry("relativePath", "src/app.txt")
                .containsEntry("lineNumber", 1)
                .containsEntry("startColumn", 1)
                .containsEntry("endColumn", 10);
    }

    @Test
    void searchTextSupportsLiteralCaseInsensitiveContextAndLimits() throws Exception {
        Files.writeString(tempDir.resolve("notes.txt"), "before\nAlpha\nmiddle\nalpha\nnext\n", StandardCharsets.UTF_8);
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("searchText", null, Map.of(
                "query", "alpha",
                "regex", false,
                "caseSensitive", false,
                "contextLines", 1,
                "maxMatches", 1
        ));

        assertThat(result).containsEntry("ok", true);
        assertThat(result).containsEntry("matchCount", 1);
        assertThat(result).containsEntry("truncated", true);
        Map<String, Object> match = ((List<Map<String, Object>>) result.get("matches")).getFirst();
        assertThat(match).containsEntry("matchText", "Alpha");
        assertThat((List<String>) match.get("before")).containsExactly("before");
        assertThat((List<String>) match.get("after")).containsExactly("middle");
    }

    @Test
    void searchTextReturnsErrorForInvalidRegex() throws Exception {
        Files.writeString(tempDir.resolve("notes.txt"), "alpha\n", StandardCharsets.UTF_8);
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("searchText", null, Map.of(
                "query", "["
        ));

        assertThat(result).containsEntry("ok", false);
        assertThat(String.valueOf(result.get("error"))).contains("Invalid regex");
    }

    @Test
    void searchTextRespectsGitIgnoreDirectoryNegationAndNestedRules() throws Exception {
        Files.createDirectories(tempDir.resolve("logs/keep"));
        Files.createDirectories(tempDir.resolve("module"));
        Files.writeString(tempDir.resolve(".gitignore"), "logs/\n!logs/keep/\n", StandardCharsets.UTF_8);
        Files.writeString(tempDir.resolve("logs/app.log"), "needle hidden\n", StandardCharsets.UTF_8);
        Files.writeString(tempDir.resolve("logs/keep/app.log"), "needle kept\n", StandardCharsets.UTF_8);
        Files.writeString(tempDir.resolve("module/.gitignore"), "*.tmp\n", StandardCharsets.UTF_8);
        Files.writeString(tempDir.resolve("module/a.tmp"), "needle tmp\n", StandardCharsets.UTF_8);
        Files.writeString(tempDir.resolve("module/a.txt"), "needle txt\n", StandardCharsets.UTF_8);
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("searchText", null, Map.of(
                "query", "needle",
                "regex", false,
                "includeDefaultExcludes", false
        ));

        assertThat(result).containsEntry("ok", true);
        assertThat((List<Map<String, Object>>) result.get("matches"))
                .extracting(entry -> entry.get("relativePath"))
                .containsExactly("logs/keep/app.log", "module/a.txt");
    }

    @Test
    void searchActionsRejectPathsOutsideBaseDir() {
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("findFiles", null, Map.of(
                "path", tempDir.getParent().toString()
        ));

        assertThat(result).containsEntry("ok", false);
        assertThat(String.valueOf(result.get("error"))).contains("outside the allowed base directory");
    }

    @Test
    void execReturnsStdout() {
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(Path.of(".").toAbsolutePath().normalize().toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("exec", null, Map.of(
                "command", "printf 'hello'",
                "shell", "sh"
        ));

        assertThat(result).containsEntry("ok", true);
        assertThat(result).containsEntry("timedOut", false);
        assertThat(result.get("stdout")).isEqualTo("hello");
    }

    @Test
    void execReturnsNonZeroWhenCheckFalse() {
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("exec", null, Map.of(
                "command", "exit 7",
                "check", false,
                "shell", "sh"
        ));

        assertThat(result).containsEntry("ok", false);
        assertThat(result).containsEntry("exitCode", 7);
    }

    @Test
    void execThrowsWhenCheckTrueAndCommandFails() {
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        assertThatThrownBy(() -> plugin.invoke("exec", null, Map.of(
                "command", "exit 7",
                "shell", "sh"
        ))).isInstanceOf(PluginRuntimeException.class)
                .hasMessageContaining("Shell command failed");
    }

    @Test
    void execTimesOutWhenCheckFalse() {
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("exec", null, Map.of(
                "command", "sleep 2",
                "timeoutSeconds", 1,
                "check", false,
                "shell", "sh"
        ));

        assertThat(result).containsEntry("ok", false);
        assertThat(result).containsEntry("timedOut", true);
    }

    @Test
    void execRejectsMissingCwd() {
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.toString());
        Path missing = tempDir.resolve("missing");

        assertThatThrownBy(() -> plugin.invoke("exec", null, Map.of(
                "command", "pwd",
                "cwd", missing.toString(),
                "shell", "sh"
        ))).isInstanceOf(PluginRuntimeException.class)
                .hasMessageContaining("cwd is not a directory");
    }

    @Test
    void execCanUseCwdOutsideWorkspaceBaseDir() throws Exception {
        ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(tempDir.resolve("workspace").toString());
        Path outside = tempDir.resolve("outside");
        Files.createDirectories(outside);

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("exec", null, Map.of(
                "command", "pwd",
                "cwd", outside.toString(),
                "shell", "sh"
        ));

        assertThat(result).containsEntry("ok", true);
        assertThat(result).containsEntry("cwd", outside.toString());
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
    void getSystemInfoPrefersNativeWindowsShells() {
        String originalOsName = System.getProperty("os.name");
        System.setProperty("os.name", "Windows 11");
        try {
            ActionDockWorkspaceSystemPlugin plugin = new ActionDockWorkspaceSystemPlugin(
                    tempDir.toString(),
                    command -> switch (command) {
                        case "powershell.exe", "cmd.exe" -> tempDir.resolve(command);
                        default -> null;
                    }
            );

            @SuppressWarnings("unchecked")
            Map<String, Object> result = (Map<String, Object>) plugin.invoke("getSystemInfo", null, Map.of());

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> shells = (List<Map<String, Object>>) result.get("shells");

            assertThat(shells)
                    .extracting(entry -> entry.get("name"))
                    .containsExactly("powershell.exe", "cmd.exe");
        } finally {
            restoreOsName(originalOsName);
        }
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

    private ActionDockWorkspaceSystemPlugin pluginWithDetectedEnvironment() {
        List<String> availableCommands = List.of("bash", "git");
        return new ActionDockWorkspaceSystemPlugin(
                tempDir.toString(),
                command -> availableCommands.contains(command) ? tempDir.resolve(command) : null
        );
    }

    private void restoreOsName(String originalOsName) {
        if (originalOsName == null) {
            System.clearProperty("os.name");
            return;
        }
        System.setProperty("os.name", originalOsName);
    }
}
