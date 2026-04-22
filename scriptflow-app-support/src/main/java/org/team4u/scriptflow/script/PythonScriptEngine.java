package org.team4u.scriptflow.script;

import org.team4u.scriptflow.config.AppProperties;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptExecutionContext;
import org.team4u.scriptflow.domain.port.JsonCodec;
import org.team4u.scriptflow.domain.port.ScriptEngine;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

public class PythonScriptEngine implements ScriptEngine {
    private static final String VALIDATION_RUNNER = """
            import py_compile
            import sys

            py_compile.compile(sys.argv[1], doraise=True)
            """;

    private final JsonCodec jsonCodec;
    private final AppProperties.Python properties;

    public PythonScriptEngine(JsonCodec jsonCodec, AppProperties.Python properties) {
        this.jsonCodec = Objects.requireNonNull(jsonCodec);
        this.properties = Objects.requireNonNull(properties);
    }

    @Override
    public void validate(ScriptDefinition definition) {
        Path scriptPath = null;
        try {
            scriptPath = writeScriptFile(definition.getSource(), false);
            ProcessResult result = runCommand(List.of(
                    resolveExecutable(),
                    "-c",
                    VALIDATION_RUNNER,
                    scriptPath.toAbsolutePath().toString()
            ), null);
            if (result.timedOut()) {
                throw new IllegalStateException("Python 脚本校验超时");
            }
            if (result.exitCode() != 0) {
                throw new IllegalArgumentException(extractErrorMessage(result));
            }
        } catch (IOException e) {
            throw new IllegalStateException("Failed to validate Python script", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Python validation interrupted", e);
        } finally {
            deleteIfExists(scriptPath);
        }
    }

    @Override
    public Object execute(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext) {
        Path scriptPath = null;
        try {
            scriptPath = writeScriptFile(definition.getSource(), true);
            ProcessResult result = runCommand(
                    List.of(resolveExecutable(), scriptPath.toAbsolutePath().toString()),
                    jsonCodec.write(input == null ? Map.of() : input)
            );
            if (result.timedOut()) {
                throw new IllegalStateException("Python 脚本执行超时");
            }
            if (result.exitCode() != 0) {
                throw new IllegalStateException(extractErrorMessage(result));
            }
            return jsonCodec.readUntyped(result.stdout());
        } catch (IOException e) {
            throw new IllegalStateException("Failed to execute Python script", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Python execution interrupted", e);
        } finally {
            deleteIfExists(scriptPath);
        }
    }

    private ProcessResult runCommand(List<String> command, String stdin)
            throws IOException, InterruptedException {
        ProcessBuilder processBuilder = new ProcessBuilder();
        processBuilder.command(command);
        Process process = processBuilder.start();
        CompletableFuture<String> stdoutFuture = CompletableFuture.supplyAsync(() -> readStream(process.getInputStream()));
        CompletableFuture<String> stderrFuture = CompletableFuture.supplyAsync(() -> readStream(process.getErrorStream()));

        try (OutputStream stdinStream = process.getOutputStream()) {
            if (stdin != null) {
                stdinStream.write(stdin.getBytes(StandardCharsets.UTF_8));
            }
        }

        boolean finished = process.waitFor(properties.getTimeoutSeconds(), TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            process.waitFor();
        }

        return new ProcessResult(
                finished ? process.exitValue() : -1,
                stdoutFuture.join(),
                stderrFuture.join(),
                !finished
        );
    }

    private String resolveExecutable() {
        if (properties.getExecutable() == null || properties.getExecutable().isBlank()) {
            return "python3";
        }
        return properties.getExecutable().trim();
    }

    private Path writeScriptFile(String source, boolean executable) throws IOException {
        Path scriptPath = Files.createTempFile("scriptflow-python-", ".py");
        String content = executable ? buildExecutableScript(source) : buildWrappedSource(source);
        Files.writeString(scriptPath, content, StandardCharsets.UTF_8);
        return scriptPath;
    }

    private String buildExecutableScript(String source) {
        return buildWrappedSource(source) + """

                if __name__ == "__main__":
                    payload_text = sys.stdin.read()
                    input = {} if not payload_text.strip() else json.loads(payload_text)
                    result = __scriptflow_main(input)
                    json.dump(result, sys.stdout, ensure_ascii=False)
                """;
    }

    private String buildWrappedSource(String source) {
        String normalizedSource = source == null ? "" : source.replace("\r\n", "\n");
        if (normalizedSource.isBlank()) {
            normalizedSource = "return {}";
        }
        List<String> lines = new ArrayList<>();
        lines.add("import json");
        lines.add("import sys");
        lines.add("");
        lines.add("def __scriptflow_main(input):");
        lines.addAll(indent(normalizedSource));
        return String.join("\n", lines) + "\n";
    }

    private List<String> indent(String source) {
        String[] lines = source.split("\n", -1);
        List<String> indented = new ArrayList<>();
        for (String line : lines) {
            indented.add(line.isEmpty() ? "    " : "    " + line);
        }
        return indented;
    }

    private String readStream(InputStream stream) {
        try (InputStream inputStream = stream) {
            return new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to read Python process output", e);
        }
    }

    private String extractErrorMessage(ProcessResult result) {
        String stderr = result.stderr() == null ? "" : result.stderr().trim();
        if (!stderr.isEmpty()) {
            return stderr;
        }
        String stdout = result.stdout() == null ? "" : result.stdout().trim();
        if (!stdout.isEmpty()) {
            return stdout;
        }
        return "Python 脚本执行失败";
    }

    private void deleteIfExists(Path path) {
        if (path == null) {
            return;
        }
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
        }
    }

    record ProcessResult(int exitCode, String stdout, String stderr, boolean timedOut) {
    }
}
