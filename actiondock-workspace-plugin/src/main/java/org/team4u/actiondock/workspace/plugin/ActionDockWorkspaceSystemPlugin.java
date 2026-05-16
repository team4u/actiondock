package org.team4u.actiondock.workspace.plugin;

import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

/**
 * Built-in workspace plugin for agent file-system and shell operations.
 */
public class ActionDockWorkspaceSystemPlugin implements ActionDockPlugin {
    public static final String PLUGIN_ID = "actiondock-workspace";

    private static final int DEFAULT_TIMEOUT_SECONDS = 30;
    private static final int DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
    private static final int DEFAULT_SNIPPET_CONTEXT_LINES = 5;

    private final Path defaultBaseDir;

    public ActionDockWorkspaceSystemPlugin() {
        this(Paths.get(".").toAbsolutePath().normalize().toString());
    }

    public ActionDockWorkspaceSystemPlugin(String defaultBaseDir) {
        String value = defaultBaseDir == null || defaultBaseDir.isBlank() ? "." : defaultBaseDir;
        this.defaultBaseDir = Paths.get(value).toAbsolutePath().normalize();
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
                case "executeShellCommand" -> executeShellCommand(values);
                default -> throw new IllegalArgumentException("Unsupported workspace action: " + action);
            };
        } catch (PluginRuntimeException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new PluginRuntimeException("Workspace action failed: " + exception.getMessage(), exception);
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

    private Map<String, Object> executeShellCommand(Map<String, Object> values) throws IOException, InterruptedException {
        String command = requiredString(values, "command");
        int timeoutSeconds = intValue(values.get("timeoutSeconds"), DEFAULT_TIMEOUT_SECONDS);
        int maxOutputBytes = intValue(values.get("maxOutputBytes"), DEFAULT_MAX_OUTPUT_BYTES);
        Path baseDir = baseDir(values);
        String cwdValue = optionalString(values.get("cwd"));
        Path cwd = cwdValue == null ? baseDir : validatePath(cwdValue, baseDir);
        if (!Files.exists(cwd)) {
            Files.createDirectories(cwd);
        }
        if (!Files.isDirectory(cwd)) {
            return error("cwd is not a directory: " + cwd);
        }

        List<List<String>> shellCandidates = shellCandidates(values);
        Set<String> allowedCommands = stringSet(values.get("allowedCommands"));
        if (!allowedCommands.isEmpty() && !allowed(command, allowedCommands)) {
            return error("Command is not allowed by allowedCommands: " + command);
        }

        IOException lastStartError = null;
        for (List<String> shell : shellCandidates) {
            try {
                return runProcess(shell, command, cwd, envMap(values.get("env")), timeoutSeconds, maxOutputBytes);
            } catch (IOException exception) {
                lastStartError = exception;
            }
        }
        throw lastStartError == null ? new IOException("No usable shell found.") : lastStartError;
    }

    private Map<String, Object> runProcess(List<String> shell,
                                           String command,
                                           Path cwd,
                                           Map<String, String> extraEnv,
                                           int timeoutSeconds,
                                           int maxOutputBytes) throws IOException, InterruptedException {
        List<String> processCommand = new ArrayList<>(shell);
        processCommand.add(command);
        ProcessBuilder builder = new ProcessBuilder(processCommand);
        builder.directory(cwd.toFile());
        builder.environment().putAll(extraEnv);
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

        String stdoutText = stdout.toString(StandardCharsets.UTF_8);
        String stderrText = stderr.toString(StandardCharsets.UTF_8);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", finished && process.exitValue() == 0);
        result.put("message", finished ? "Command finished." : "Command timed out.");
        result.put("command", command);
        result.put("cwd", cwd.toString());
        result.put("shell", shell);
        result.put("exitCode", finished ? process.exitValue() : null);
        result.put("stdout", stdoutText);
        result.put("stderr", stderrText);
        result.put("durationMs", System.currentTimeMillis() - started);
        result.put("timedOut", !finished);
        result.put("stdoutTruncated", stdout.size() >= maxOutputBytes);
        result.put("stderrTruncated", stderr.size() >= maxOutputBytes);
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
                // Best effort stream capture.
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
            candidates.add(List.of(shellPath, "-lc"));
            return candidates;
        }
        if (windows) {
            candidates.add(List.of("bash.exe", "-lc"));
            candidates.add(List.of("C:\\Program Files\\Git\\bin\\bash.exe", "-lc"));
            candidates.add(List.of("C:\\Program Files\\Git\\usr\\bin\\bash.exe", "-lc"));
            candidates.add(List.of("C:\\Program Files (x86)\\Git\\bin\\bash.exe", "-lc"));
            candidates.add(List.of("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"));
            candidates.add(List.of("cmd.exe", "/d", "/s", "/c"));
        } else {
            candidates.add(List.of("bash", "-lc"));
            candidates.add(List.of("/bin/bash", "-lc"));
            candidates.add(List.of("/bin/sh", "-lc"));
        }
        return candidates;
    }

    private boolean allowed(String command, Set<String> allowedCommands) {
        String trimmed = command == null ? "" : command.trim();
        return allowedCommands.stream().anyMatch(allowed -> trimmed.equals(allowed) || trimmed.startsWith(allowed + " "));
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
}
