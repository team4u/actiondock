package org.team4u.scriptflow.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.PrintStream;

public final class CliOutput {
    private final ObjectMapper objectMapper;
    private final PrintStream stdout;
    private final PrintStream stderr;

    public CliOutput(ObjectMapper objectMapper, PrintStream stdout, PrintStream stderr) {
        this.objectMapper = objectMapper;
        this.stdout = stdout;
        this.stderr = stderr;
    }

    public ObjectMapper objectMapper() {
        return objectMapper;
    }

    public ObjectNode success(JsonNode data) {
        return envelope(0, "处理成功", data);
    }

    public ObjectNode success(JsonNode data, String message) {
        return envelope(0, message, data);
    }

    public ObjectNode error(int status, String message) {
        return envelope(status, message, null);
    }

    public ObjectNode error(int status, String message, JsonNode data) {
        return envelope(status, message, data);
    }

    public void printStdout(JsonNode value) {
        print(stdout, value);
    }

    public void printStderr(JsonNode value) {
        print(stderr, value);
    }

    private ObjectNode envelope(int status, String message, JsonNode data) {
        ObjectNode envelope = objectMapper.createObjectNode();
        envelope.put("status", status);
        envelope.put("msg", message);
        if (data == null) {
            envelope.putNull("data");
        } else {
            envelope.set("data", data);
        }
        return envelope;
    }

    private void print(PrintStream stream, JsonNode value) {
        try {
            stream.println(objectMapper.writeValueAsString(value));
        } catch (Exception exception) {
            throw new IllegalStateException("JSON 输出失败", exception);
        }
    }
}
