package org.team4u.actiondock.workspace.plugin;

import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;
import org.team4u.actiondock.common.shell.ShellExecutionOptions;
import org.team4u.actiondock.common.shell.ShellExecutionResult;
import org.team4u.actiondock.common.shell.ShellSupport;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.stream.Stream;

/**
 * Built-in workspace plugin for agent file-system and shell operations.
 */
public class ActionDockWorkspaceSystemPlugin implements ActionDockPlugin {
    public static final String PLUGIN_ID = "actiondock-workspace";

    private static final int DEFAULT_TIMEOUT_SECONDS = 30;
    private static final int DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
    private static final int DEFAULT_SNIPPET_CONTEXT_LINES = 5;
    private static final int DEFAULT_VERSION_TIMEOUT_SECONDS = 5;
    private static final List<String> BUILTIN_COMMANDS = List.of(
            "bash", "python", "python3", "node", "npm", "npx", "git", "java", "mvn"
    );
    private static final Map<String, List<String>> VERSION_COMMANDS = createVersionCommands();

    private final Path defaultBaseDir;
    private final Function<String, Path> executableResolver;
    private final ShellSupport shellSupport = new ShellSupport();

    public ActionDockWorkspaceSystemPlugin() {
        this((String) null);
    }

    public ActionDockWorkspaceSystemPlugin(String defaultBaseDir) {
        this(defaultBaseDir, null);
    }

    ActionDockWorkspaceSystemPlugin(String defaultBaseDir, Function<String, Path> executableResolver) {
        if (defaultBaseDir == null || defaultBaseDir.isBlank()) {
            this.defaultBaseDir = Paths.get(".").toAbsolutePath().normalize().getRoot();
        } else {
            this.defaultBaseDir = Paths.get(defaultBaseDir).toAbsolutePath().normalize();
        }
        this.executableResolver = executableResolver == null ? this::resolveExecutableFromPath : executableResolver;
    }

    @Override
    public String id() {
        return PLUGIN_ID;
    }

    @Override
    public Object invoke(String action, ScriptPluginContext context, Map<String, Object> args) {
        Map<String, Object> values = args == null ? Map.of() : args;
        try {
            return switch (action) {
                case "viewTextFile" -> viewTextFile(values);
                case "listDirectory" -> listDirectory(values);
                case "writeTextFile" -> writeTextFile(values);
                case "insertTextFile" -> insertTextFile(values);
                case "findFiles" -> findFiles(values);
                case "searchText" -> searchText(values);
                case "getSystemInfo" -> getSystemInfo(values);
                case "exec" -> exec(values);
                default -> throw new IllegalArgumentException("Unsupported workspace action: " + action);
            };
        } catch (PluginRuntimeException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new PluginRuntimeException("Workspace action failed: " + exception.getMessage(), exception);
        }
    }

    private Map<String, Object> findFiles(Map<String, Object> values) throws IOException {
        try {
            return new WorkspaceSearchSupport(baseDir(values), this::validatePath).findFiles(values);
        } catch (IOException exception) {
            return error(exception.getMessage());
        }
    }

    private Map<String, Object> searchText(Map<String, Object> values) throws IOException {
        try {
            return new WorkspaceSearchSupport(baseDir(values), this::validatePath).searchText(values);
        } catch (IOException exception) {
            return error(exception.getMessage());
        }
    }

    private Map<String, Object> viewTextFile(Map<String, Object> values) throws IOException {
        String pathValue = requiredString(values, "path");
        String rangeValue = optionalString(values.get("viewRange"));
        Path path = validatePath(pathValue, baseDir(values));
        if (!Files.exists(path)) {
            return error("The file " + pathValue + " does not exist.");
        }
        if (!Files.isRegularFile(path)) {
            return error("The path " + pathValue + " is not a file.");
        }

        List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
        int start = 1;
        int end = lines.size();
        if (rangeValue != null) {
            int[] parsed = parseRanges(rangeValue);
            if (parsed == null) {
                return error("Invalid range format. Expected '[start,end]' or 'start,end', but got " + rangeValue + ".");
            }
            start = parsed[0];
            end = parsed[1];
            if (start < 0) {
                start = lines.size() + start + 1;
            }
            if (end < 0) {
                end = lines.size() + end + 1;
            }
            start = Math.max(1, start);
            end = Math.min(lines.size(), end);
            if (start > end) {
                return error("Invalid range: start line " + start + " is greater than end line " + end + ".");
            }
        }

        String content = formatLinesWithNumbers(lines, start, end);
        Map<String, Object> result = ok("The content of " + pathValue + " in lines [" + start + ", " + end + "]:");
        result.put("filePath", path.toString());
        result.put("startLine", start);
        result.put("endLine", end);
        result.put("lineCount", lines.size());
        result.put("content", content);
        return result;
    }

    private Map<String, Object> listDirectory(Map<String, Object> values) throws IOException {
        String pathValue = requiredString(values, "path");
        Path path = validatePath(pathValue, baseDir(values));
        if (!Files.exists(path)) {
            return error("The directory " + pathValue + " does not exist.");
        }
        if (!Files.isDirectory(path)) {
            return error("The path " + pathValue + " is not a directory.");
        }

        List<Map<String, Object>> directories = new ArrayList<>();
        List<Map<String, Object>> files = new ArrayList<>();
        try (Stream<Path> paths = Files.list(path)) {
            paths.sorted(Comparator.comparing(Path::toString)).forEach(item -> {
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("name", item.getFileName() == null ? item.toString() : item.getFileName().toString());
                entry.put("path", item.toAbsolutePath().normalize().toString());
                entry.put("directory", Files.isDirectory(item));
                if (Files.isDirectory(item)) {
                    directories.add(entry);
                } else {
                    try {
                        entry.put("size", Files.size(item));
                    } catch (IOException ignored) {
                        entry.put("size", null);
                    }
                    files.add(entry);
                }
            });
        }

        Map<String, Object> result = ok("Contents of directory " + pathValue + ".");
        result.put("dirPath", path.toString());
        result.put("directories", directories);
        result.put("files", files);
        result.put("directoryCount", directories.size());
        result.put("fileCount", files.size());
        return result;
    }

    private Map<String, Object> writeTextFile(Map<String, Object> values) throws IOException {
        String pathValue = requiredString(values, "path");
        String content = stringValue(values.get("content"));
        if (content == null) {
            return error("content is required");
        }
        String rangeValue = optionalString(values.get("ranges"));
        Path path = validatePath(pathValue, baseDir(values));
        Path parent = path.getParent();
        if (parent != null && !Files.exists(parent)) {
            Files.createDirectories(parent);
        }

        if (!Files.exists(path)) {
            Files.writeString(path, content, StandardCharsets.UTF_8);
            Map<String, Object> result = ok("Create and write " + pathValue + " successfully.");
            result.put("filePath", path.toString());
            result.put("created", true);
            result.put("replacedRange", null);
            return result;
        }
        if (!Files.isRegularFile(path)) {
            return error("The path " + pathValue + " is not a file.");
        }

        if (rangeValue != null) {
            List<String> originalLines = Files.readAllLines(path, StandardCharsets.UTF_8);
            int[] parsed = parseRanges(rangeValue);
            if (parsed == null) {
                return error("Invalid range format. Expected '[start,end]' or 'start,end', but got " + rangeValue + ".");
            }
            int start = parsed[0];
            int end = parsed[1];
            if (start < 1 || end < start) {
                return error("Invalid range: " + rangeValue + ".");
            }
            if (start > originalLines.size()) {
                return error("The start line " + start + " is invalid. The file only has " + originalLines.size() + " lines.");
            }
            end = Math.min(end, originalLines.size());

            List<String> newContent = new ArrayList<>();
            if (start > 1) {
                newContent.addAll(originalLines.subList(0, start - 1));
            }
            newContent.add(content);
            if (end < originalLines.size()) {
                newContent.addAll(originalLines.subList(end, originalLines.size()));
            }
            Files.writeString(path, String.join("\n", newContent), StandardCharsets.UTF_8);
            List<String> updatedLines = Files.readAllLines(path, StandardCharsets.UTF_8);
            int[] viewRange = calculateViewRanges(originalLines.size(), updatedLines.size(), start, end, DEFAULT_SNIPPET_CONTEXT_LINES);

            Map<String, Object> result = ok("Write " + pathValue + " successfully.");
            result.put("filePath", path.toString());
            result.put("created", false);
            result.put("replacedRange", List.of(start, end));
            result.put("snippet", formatLinesWithNumbers(updatedLines, viewRange[0], viewRange[1]));
            result.put("snippetRange", List.of(viewRange[0], viewRange[1]));
            return result;
        }

        Files.writeString(path, content, StandardCharsets.UTF_8);
        Map<String, Object> result = ok("Overwrite " + pathValue + " successfully.");
        result.put("filePath", path.toString());
        result.put("created", false);
        result.put("replacedRange", null);
        return result;
    }

    private Map<String, Object> insertTextFile(Map<String, Object> values) throws IOException {
        String pathValue = requiredString(values, "path");
        String content = stringValue(values.get("content"));
        if (content == null) {
            return error("content is required");
        }
        Integer lineNumber = intValue(values.get("lineNumber"));
        if (lineNumber == null || lineNumber <= 0) {
            return error("InvalidArgumentsError: The lineNumber is invalid.");
        }

        Path path = validatePath(pathValue, baseDir(values));
        if (!Files.exists(path)) {
            return error("InvalidArgumentsError: The target file " + pathValue + " does not exist.");
        }
        if (!Files.isRegularFile(path)) {
            return error("The path " + pathValue + " is not a file.");
        }

        List<String> originalLines = Files.readAllLines(path, StandardCharsets.UTF_8);
        if (lineNumber > originalLines.size() + 1) {
            return error("InvalidArgumentsError: The given lineNumber (" + lineNumber + ") is not in the valid range [1, " + (originalLines.size() + 1) + "].");
        }

        List<String> newLines = new ArrayList<>();
        if (lineNumber > 1) {
            newLines.addAll(originalLines.subList(0, lineNumber - 1));
        }
        newLines.add(content);
        if (lineNumber <= originalLines.size()) {
            newLines.addAll(originalLines.subList(lineNumber - 1, originalLines.size()));
        }
        Files.write(path, newLines, StandardCharsets.UTF_8);

        List<String> updatedLines = Files.readAllLines(path, StandardCharsets.UTF_8);
        int[] viewRange = calculateViewRanges(originalLines.size(), updatedLines.size(), lineNumber, lineNumber, DEFAULT_SNIPPET_CONTEXT_LINES);
        Map<String, Object> result = ok("Insert content into " + pathValue + " at line " + lineNumber + " successfully.");
        result.put("filePath", path.toString());
        result.put("lineNumber", lineNumber);
        result.put("snippet", formatLinesWithNumbers(updatedLines, viewRange[0], viewRange[1]));
        result.put("snippetRange", List.of(viewRange[0], viewRange[1]));
        return result;
    }

    private Map<String, Object> exec(Map<String, Object> values) {
        String command = requiredString(values, "command");
        int timeoutSeconds = intValue(values.get("timeoutSeconds"), DEFAULT_TIMEOUT_SECONDS);
        int maxOutputBytes = intValue(values.get("maxOutputBytes"), DEFAULT_MAX_OUTPUT_BYTES);
        boolean check = booleanValue(values.get("check"), true);
        ShellExecutionResult result = shellSupport.exec(command, new ShellExecutionOptions(
                resolveShellCwd(values.get("cwd")),
                envMap(values.get("env")),
                timeoutSeconds,
                maxOutputBytes,
                optionalString(values.get("shell"))
        ));
        Map<String, Object> mapped = shellResultMap(result);
        if (check && !result.ok()) {
            throw new PluginRuntimeException(500, "WORKSPACE_SHELL_EXEC_FAILED", buildShellFailureMessage(command, result), mapped);
        }
        return mapped;
    }

    private Map<String, Object> getSystemInfo(Map<String, Object> values) throws IOException, InterruptedException {
        Path baseDir = baseDir(values);
        Files.createDirectories(baseDir);

        Map<String, Object> result = ok("System information collected.");
        result.put("workspace", workspaceInfo(baseDir));
        result.put("system", systemInfo());
        result.put("pathEntries", pathEntries());
        result.put("shells", shellInfo(values));
        result.put("commands", commandInfo(values));
        return result;
    }

    private Path resolveShellCwd(Object value) {
        if (value == null || String.valueOf(value).isBlank()) {
            return Paths.get(".").toAbsolutePath().normalize();
        }
        Path cwd = Paths.get(String.valueOf(value));
        return cwd.isAbsolute() ? cwd.normalize() : cwd.toAbsolutePath().normalize();
    }

    private Map<String, Object> shellResultMap(ShellExecutionResult result) {
        Map<String, Object> mapped = new LinkedHashMap<>();
        mapped.put("command", result.command());
        mapped.put("cwd", result.cwd().toString());
        mapped.put("shell", result.shell());
        mapped.put("durationMs", result.durationMs());
        mapped.put("ok", result.ok());
        mapped.put("exitCode", result.exitCode());
        mapped.put("stdout", result.stdout());
        mapped.put("stderr", result.stderr());
        mapped.put("timedOut", result.timedOut());
        mapped.put("stdoutTruncated", result.stdoutTruncated());
        mapped.put("stderrTruncated", result.stderrTruncated());
        return mapped;
    }

    private String buildShellFailureMessage(String command, ShellExecutionResult result) {
        if (result.timedOut()) {
            return "Shell command timed out: " + command;
        }
        return "Shell command failed: " + command + " (exitCode=" + result.exitCode() + ")";
    }

    private Map<String, Object> workspaceInfo(Path baseDir) {
        Map<String, Object> workspace = new LinkedHashMap<>();
        workspace.put("resolvedBaseDir", baseDir.toString());
        workspace.put("processWorkingDirectory", Paths.get(".").toAbsolutePath().normalize().toString());
        return workspace;
    }

    private Map<String, Object> systemInfo() {
        Map<String, Object> system = new LinkedHashMap<>();
        system.put("osName", System.getProperty("os.name", ""));
        system.put("osVersion", System.getProperty("os.version", ""));
        system.put("osArch", System.getProperty("os.arch", ""));
        system.put("javaVersion", System.getProperty("java.version", ""));
        system.put("javaVendor", System.getProperty("java.vendor", ""));
        system.put("pathSeparator", File.pathSeparator);
        return system;
    }

    private List<String> pathEntries() {
        String path = System.getenv("PATH");
        if (path == null || path.isBlank()) {
            return List.of();
        }
        List<String> entries = new ArrayList<>();
        for (String item : path.split(java.util.regex.Pattern.quote(File.pathSeparator))) {
            if (!item.isBlank()) {
                entries.add(item);
            }
        }
        return entries;
    }

    private List<Map<String, Object>> shellInfo(Map<String, Object> values) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (List<String> shell : shellCandidates(values)) {
            String executable = shell.isEmpty() ? "" : shell.getFirst();
            Path resolved = resolveExecutable(executable);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("name", executable);
            item.put("available", resolved != null);
            item.put("resolvedPath", resolved == null ? null : resolved.toString());
            result.add(item);
        }
        return result;
    }

    private List<Map<String, Object>> commandInfo(Map<String, Object> values) {
        List<Map<String, Object>> result = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (String command : BUILTIN_COMMANDS) {
            seen.add(command);
            result.add(probeBuiltinCommand(command));
        }
        for (String command : stringSet(values.get("additionalCommands"))) {
            if (seen.add(command)) {
                result.add(probeAdditionalCommand(command));
            }
        }
        return result;
    }

    private Map<String, Object> probeBuiltinCommand(String command) {
        Map<String, Object> item = baseCommandProbe(command, "builtin");
        List<String> versionCommand = VERSION_COMMANDS.get(command);
        item.put("versionCommand", versionCommand == null ? null : String.join(" ", versionCommand));
        if (!Boolean.TRUE.equals(item.get("available")) || versionCommand == null) {
            item.put("versionText", null);
            item.put("versionExitCode", null);
            item.put("versionTimedOut", false);
            return item;
        }

        try {
            List<String> resolvedVersionCommand = resolvedVersionCommand(versionCommand, (String) item.get("resolvedPath"));
            Map<String, Object> version = runDirectCommand(resolvedVersionCommand, DEFAULT_VERSION_TIMEOUT_SECONDS, DEFAULT_MAX_OUTPUT_BYTES);
            String text = firstNonBlank((String) version.get("stdout"), (String) version.get("stderr"));
            item.put("versionText", text == null ? "" : text.strip());
            item.put("versionExitCode", version.get("exitCode"));
            item.put("versionTimedOut", version.get("timedOut"));
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            item.put("versionText", null);
            item.put("versionExitCode", null);
            item.put("versionTimedOut", false);
            item.put("versionError", exception.getMessage());
        } catch (IOException exception) {
            item.put("versionText", null);
            item.put("versionExitCode", null);
            item.put("versionTimedOut", false);
            item.put("versionError", exception.getMessage());
        }
        return item;
    }

    private Map<String, Object> probeAdditionalCommand(String command) {
        Map<String, Object> item = baseCommandProbe(command, "additional");
        item.put("versionCommand", null);
        item.put("versionText", null);
        item.put("versionExitCode", null);
        item.put("versionTimedOut", false);
        return item;
    }

    private Map<String, Object> baseCommandProbe(String command, String source) {
        Path resolved = resolveExecutable(command);
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("name", command);
        item.put("source", source);
        item.put("available", resolved != null);
        item.put("resolvedPath", resolved == null ? null : resolved.toString());
        return item;
    }

    private List<String> resolvedVersionCommand(List<String> command, String resolvedExecutable) {
        if (command.isEmpty() || resolvedExecutable == null || resolvedExecutable.isBlank()) {
            return command;
        }
        List<String> result = new ArrayList<>(command);
        result.set(0, resolvedExecutable);
        return result;
    }

    private Map<String, Object> runDirectCommand(List<String> command,
                                                 int timeoutSeconds,
                                                 int maxOutputBytes) throws IOException, InterruptedException {
        ProcessBuilder builder = new ProcessBuilder(command);
        long started = System.currentTimeMillis();
        Process process = builder.start();

        ByteArrayOutputStream stdout = new ByteArrayOutputStream();
        ByteArrayOutputStream stderr = new ByteArrayOutputStream();
        Thread outThread = streamCollector(process.getInputStream(), stdout, maxOutputBytes);
        Thread errThread = streamCollector(process.getErrorStream(), stderr, maxOutputBytes);

        boolean finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            process.waitFor(3, TimeUnit.SECONDS);
        }
        outThread.join(Duration.ofSeconds(1));
        errThread.join(Duration.ofSeconds(1));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", finished && process.exitValue() == 0);
        result.put("stdout", stdout.toString(StandardCharsets.UTF_8));
        result.put("stderr", stderr.toString(StandardCharsets.UTF_8));
        result.put("exitCode", finished ? process.exitValue() : null);
        result.put("durationMs", System.currentTimeMillis() - started);
        result.put("timedOut", !finished);
        return result;
    }

    private Thread streamCollector(InputStream inputStream, ByteArrayOutputStream output, int maxBytes) {
        Thread thread = new Thread(() -> {
            byte[] buffer = new byte[4096];
            try (inputStream) {
                int read;
                while ((read = inputStream.read(buffer)) >= 0) {
                    int remaining = maxBytes - output.size();
                    if (remaining > 0) {
                        output.write(buffer, 0, Math.min(read, remaining));
                    }
                }
            } catch (IOException ignored) {
                // Best effort stream capture for system probes.
            }
        });
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    private List<List<String>> shellCandidates(Map<String, Object> values) {
        String shellPath = optionalString(values.get("shellPath"));
        String osName = System.getProperty("os.name", "").toLowerCase();
        boolean windows = osName.contains("win");
        List<List<String>> candidates = new ArrayList<>();
        if (shellPath != null) {
            candidates.add(shellCommand(shellPath));
            return candidates;
        }
        if (windows) {
            candidates.add(shellCommand("powershell.exe"));
            candidates.add(shellCommand("cmd.exe"));
        } else {
            candidates.add(shellCommand("bash"));
            candidates.add(shellCommand("/bin/bash"));
            candidates.add(shellCommand("/bin/sh"));
        }
        return candidates;
    }

    private List<String> shellCommand(String shellPath) {
        String executableName = shellExecutableName(shellPath);
        if (executableName.equals("powershell") || executableName.equals("powershell.exe")
                || executableName.equals("pwsh") || executableName.equals("pwsh.exe")) {
            return List.of(shellPath, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command");
        }
        if (executableName.equals("cmd") || executableName.equals("cmd.exe")) {
            return List.of(shellPath, "/d", "/s", "/c");
        }
        return List.of(shellPath, "-lc");
    }

    private String shellExecutableName(String shellPath) {
        String normalized = shellPath == null ? "" : shellPath.replace('\\', '/');
        int separator = normalized.lastIndexOf('/');
        String name = separator >= 0 ? normalized.substring(separator + 1) : normalized;
        return name.toLowerCase();
    }

    private Path resolveExecutable(String executable) {
        return executableResolver.apply(executable);
    }

    private Path resolveExecutableFromPath(String executable) {
        if (executable == null || executable.isBlank()) {
            return null;
        }
        Path direct;
        try {
            direct = Paths.get(executable);
        } catch (InvalidPathException exception) {
            return null;
        }
        if (direct.isAbsolute() || executable.contains("/") || executable.contains("\\")) {
            return Files.isExecutable(direct) ? direct.toAbsolutePath().normalize() : null;
        }

        String path = System.getenv("PATH");
        if (path == null || path.isBlank()) {
            return null;
        }
        boolean windows = System.getProperty("os.name", "").toLowerCase().contains("win");
        List<String> candidates = windows ? executableCandidates(executable) : List.of(executable);
        for (String entry : path.split(java.util.regex.Pattern.quote(File.pathSeparator))) {
            if (entry == null || entry.isBlank()) {
                continue;
            }
            for (String candidate : candidates) {
                Path resolved;
                try {
                    resolved = Paths.get(entry, candidate);
                } catch (InvalidPathException exception) {
                    continue;
                }
                if (Files.isRegularFile(resolved) && Files.isExecutable(resolved)) {
                    return resolved.toAbsolutePath().normalize();
                }
            }
        }
        return null;
    }

    private List<String> executableCandidates(String executable) {
        String lower = executable.toLowerCase();
        if (lower.endsWith(".exe") || lower.endsWith(".cmd") || lower.endsWith(".bat")) {
            return List.of(executable);
        }
        return List.of(executable + ".exe", executable + ".cmd", executable + ".bat", executable);
    }

    private Path baseDir(Map<String, Object> values) {
        String value = optionalString(values.get("baseDir"));
        if (value == null) {
            return defaultBaseDir;
        }
        return Paths.get(value).toAbsolutePath().normalize();
    }

    private Path validatePath(String filePath, Path baseDir) throws IOException {
        if (filePath == null || filePath.trim().isEmpty()) {
            throw new IOException("File path cannot be null or empty.");
        }
        Path inputPath = Paths.get(filePath);
        Path path = inputPath.isAbsolute() ? inputPath.toAbsolutePath().normalize() : baseDir.resolve(inputPath).normalize();
        Path normalizedBaseDir = baseDir.toAbsolutePath().normalize();
        if (!path.startsWith(normalizedBaseDir)) {
            throw new IOException("Access denied: The file path '" + filePath + "' is outside the allowed base directory '" + normalizedBaseDir + "'.");
        }
        return path;
    }

    private String formatLinesWithNumbers(List<String> lines, int start, int end) {
        StringBuilder result = new StringBuilder();
        int startIndex = Math.max(0, start - 1);
        int endIndex = Math.min(lines.size() - 1, end - 1);
        for (int i = startIndex; i <= endIndex && i < lines.size(); i++) {
            result.append(i + 1).append(": ").append(lines.get(i)).append('\n');
        }
        return result.toString();
    }

    private int[] parseRanges(String ranges) {
        try {
            String cleaned = ranges.trim().replaceAll("^\\[", "").replaceAll("\\]$", "").trim();
            String[] parts = cleaned.split(",");
            if (parts.length != 2) {
                return null;
            }
            return new int[]{Integer.parseInt(parts[0].trim()), Integer.parseInt(parts[1].trim())};
        } catch (NumberFormatException exception) {
            return null;
        }
    }

    private int[] calculateViewRanges(int originalLineCount, int newLineCount, int modifyStart, int modifyEnd, int extraViewLines) {
        int viewStart = Math.max(1, modifyStart - extraViewLines);
        int viewEnd = Math.min(newLineCount, modifyStart + (newLineCount - originalLineCount) + (modifyEnd - modifyStart) + extraViewLines);
        return new int[]{viewStart, viewEnd};
    }

    private Map<String, Object> ok(String message) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("message", message);
        return result;
    }

    private Map<String, Object> error(String message) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", false);
        result.put("error", message);
        result.put("message", message);
        return result;
    }

    private String requiredString(Map<String, Object> values, String key) {
        String value = stringValue(values.get(key));
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(key + " is required");
        }
        return value;
    }

    private String optionalString(Object value) {
        String text = stringValue(value);
        return text == null || text.isBlank() ? null : text;
    }

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private Integer intValue(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException exception) {
            return null;
        }
    }

    private int intValue(Object value, int defaultValue) {
        Integer integer = intValue(value);
        return integer == null ? defaultValue : integer;
    }

    private boolean booleanValue(Object value, boolean defaultValue) {
        if (value == null) {
            return defaultValue;
        }
        if (value instanceof Boolean bool) {
            return bool;
        }
        return Boolean.parseBoolean(String.valueOf(value));
    }

    @SuppressWarnings("unchecked")
    private Map<String, String> envMap(Object value) {
        Map<String, String> result = new LinkedHashMap<>();
        if (value instanceof Map<?, ?> map) {
            map.forEach((key, item) -> {
                if (key != null && item != null) {
                    result.put(String.valueOf(key), String.valueOf(item));
                }
            });
        }
        return result;
    }

    private Set<String> stringSet(Object value) {
        Set<String> result = new LinkedHashSet<>();
        if (value instanceof Iterable<?> iterable) {
            iterable.forEach(item -> {
                if (item != null && !String.valueOf(item).isBlank()) {
                    result.add(String.valueOf(item).trim());
                }
            });
        } else if (value instanceof String text && !text.isBlank()) {
            for (String item : text.split(",")) {
                if (!item.isBlank()) {
                    result.add(item.trim());
                }
            }
        }
        return result;
    }

    private static Map<String, List<String>> createVersionCommands() {
        Map<String, List<String>> commands = new HashMap<>();
        commands.put("bash", List.of("bash", "--version"));
        commands.put("python", List.of("python", "--version"));
        commands.put("python3", List.of("python3", "--version"));
        commands.put("node", List.of("node", "--version"));
        commands.put("npm", List.of("npm", "--version"));
        commands.put("npx", List.of("npx", "--version"));
        commands.put("git", List.of("git", "--version"));
        commands.put("java", List.of("java", "-version"));
        commands.put("mvn", List.of("mvn", "-version"));
        return commands;
    }

    private String firstNonBlank(String first, String second) {
        if (first != null && !first.isBlank()) {
            return first;
        }
        if (second != null && !second.isBlank()) {
            return second;
        }
        return null;
    }
}
