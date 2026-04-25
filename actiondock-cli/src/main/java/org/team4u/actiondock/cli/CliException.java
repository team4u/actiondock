package org.team4u.actiondock.cli;

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

    /**
     * 将异常信息以 JSON 格式输出到标准错误流。
     *
     * @param output CLI 输出工具
     */
    public void writeTo(CliOutput output) {
        output.printStderr(payload);
    }

    /**
     * 创建参数校验失败异常（退出码 2）。
     *
     * @param output  CLI 输出工具
     * @param message 错误描述信息
     * @return 校验异常实例
     */
    public static CliException validation(CliOutput output, String message) {
        return new CliException(EXIT_VALIDATION, message, output.error(EXIT_VALIDATION, message));
    }

    /**
     * 创建配置错误异常（退出码 3）。
     *
     * @param output  CLI 输出工具
     * @param message 错误描述信息
     * @return 配置异常实例
     */
    public static CliException config(CliOutput output, String message) {
        return new CliException(EXIT_CONFIG, message, output.error(EXIT_CONFIG, message));
    }

    /**
     * 创建带附加数据的配置错误异常（退出码 3）。
     *
     * @param output  CLI 输出工具
     * @param message 错误描述信息
     * @param data    附加的 JSON 数据
     * @return 配置异常实例
     */
    public static CliException config(CliOutput output, String message, JsonNode data) {
        return new CliException(EXIT_CONFIG, message, output.error(EXIT_CONFIG, message, data));
    }

    /**
     * 创建 HTTP 通信异常（退出码 4）。
     *
     * @param output  CLI 输出工具
     * @param message 错误描述信息
     * @return 通信异常实例
     */
    public static CliException transport(CliOutput output, String message) {
        return new CliException(EXIT_TRANSPORT, message, output.error(EXIT_TRANSPORT, message));
    }

    /**
     * 创建带附加数据的 HTTP 通信异常（退出码 4）。
     *
     * @param output  CLI 输出工具
     * @param message 错误描述信息
     * @param data    附加的 JSON 数据
     * @return 通信异常实例
     */
    public static CliException transport(CliOutput output, String message, JsonNode data) {
        return new CliException(EXIT_TRANSPORT, message, output.error(EXIT_TRANSPORT, message, data));
    }

    /**
     * 创建业务逻辑异常（退出码 5）。
     *
     * @param output  CLI 输出工具
     * @param message 错误描述信息
     * @return 业务异常实例
     */
    public static CliException business(CliOutput output, String message) {
        return new CliException(EXIT_BUSINESS, message, output.error(EXIT_BUSINESS, message));
    }

    /**
     * 创建超时异常（退出码 6）。
     *
     * @param output  CLI 输出工具
     * @param message 错误描述信息
     * @param data    附加的 JSON 数据，如 executionId、lastStatus 等
     * @return 超时异常实例
     */
    public static CliException timeout(CliOutput output, String message, JsonNode data) {
        return new CliException(EXIT_TIMEOUT, message, output.error(EXIT_TIMEOUT, message, data));
    }

    /**
     * 根据服务端响应创建异常，保留服务端返回的退出码和 JSON 载荷。
     *
     * @param exitCode 退出码，来自服务端 HTTP 状态码映射
     * @param message  错误描述信息
     * @param payload  服务端返回的 JSON 载荷
     * @return 包装了服务端错误的异常实例
     */
    public static CliException fromServer(int exitCode, String message, JsonNode payload) {
        return new CliException(exitCode, message, payload);
    }
}
