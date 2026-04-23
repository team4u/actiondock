package org.team4u.scriptflow.cli;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * CLI 异常，封装各类错误场景并携带结构化的退出码和 JSON 载荷。
 *
 * @author jay.wu
 */
public final class CliException extends RuntimeException {
    public static final int EXIT_VALIDATION = 2;
    public static final int EXIT_CONFIG = 3;
    public static final int EXIT_TRANSPORT = 4;
    public static final int EXIT_BUSINESS = 5;
    public static final int EXIT_TIMEOUT = 6;

    private final int exitCode;
    private final JsonNode payload;

    public CliException(int exitCode, String message, JsonNode payload) {
        super(message);
        this.exitCode = exitCode;
        this.payload = payload;
    }

    public int exitCode() {
        return exitCode;
    }

    public JsonNode payload() {
        return payload;
    }

    public void writeTo(CliOutput output) {
        output.printStderr(payload);
    }

    public static CliException validation(CliOutput output, String message) {
        return new CliException(EXIT_VALIDATION, message, output.error(EXIT_VALIDATION, message));
    }

    public static CliException config(CliOutput output, String message) {
        return new CliException(EXIT_CONFIG, message, output.error(EXIT_CONFIG, message));
    }

    public static CliException config(CliOutput output, String message, JsonNode data) {
        return new CliException(EXIT_CONFIG, message, output.error(EXIT_CONFIG, message, data));
    }

    public static CliException transport(CliOutput output, String message) {
        return new CliException(EXIT_TRANSPORT, message, output.error(EXIT_TRANSPORT, message));
    }

    public static CliException transport(CliOutput output, String message, JsonNode data) {
        return new CliException(EXIT_TRANSPORT, message, output.error(EXIT_TRANSPORT, message, data));
    }

    public static CliException business(CliOutput output, String message) {
        return new CliException(EXIT_BUSINESS, message, output.error(EXIT_BUSINESS, message));
    }

    public static CliException timeout(CliOutput output, String message, JsonNode data) {
        return new CliException(EXIT_TIMEOUT, message, output.error(EXIT_TIMEOUT, message, data));
    }

    public static CliException fromServer(int exitCode, String message, JsonNode payload) {
        return new CliException(exitCode, message, payload);
    }
}
