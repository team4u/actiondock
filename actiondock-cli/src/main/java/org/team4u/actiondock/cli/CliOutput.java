package org.team4u.actiondock.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.PrintStream;

/**
 * CLI 输出工具，以 JSON 格式输出统一信封到 stdout 或 stderr。
 *
 * @author jay.wu
 */
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

    /**
     * 构建成功响应信封，使用默认消息 "Success"。
     *
     * @param data 业务数据
     * @return 包含 status=0 和数据的 JSON 信封
     */
    public ObjectNode success(JsonNode data) {
        return envelope(0, "Success", data);
    }

    /**
     * 构建成功响应信封，使用自定义消息。
     *
     * @param data    业务数据
     * @param message 自定义成功消息
     * @return 包含 status=0 和数据的 JSON 信封
     */
    public ObjectNode success(JsonNode data, String message) {
        return envelope(0, message, data);
    }

    /**
     * 构建错误响应信封，不含附加数据。
     *
     * @param status  错误状态码（非零）
     * @param message 错误描述信息
     * @return 包含错误状态和消息的 JSON 信封
     */
    public ObjectNode error(int status, String message) {
        return envelope(status, message, null);
    }

    /**
     * 构建错误响应信封，包含附加数据。
     *
     * @param status  错误状态码（非零）
     * @param message 错误描述信息
     * @param data    附加的错误详情数据
     * @return 包含错误状态、消息和数据的 JSON 信封
     */
    public ObjectNode error(int status, String message, JsonNode data) {
        return envelope(status, message, data);
    }

    /**
     * 将 JSON 内容输出到标准输出流。
     *
     * @param value 要输出的 JSON 节点
     */
    public void printStdout(JsonNode value) {
        print(stdout, value);
    }

    /**
     * 将 JSON 内容输出到标准错误流。
     *
     * @param value 要输出的 JSON 节点
     */
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
            throw new IllegalStateException("Failed to write JSON output", exception);
        }
    }
}
