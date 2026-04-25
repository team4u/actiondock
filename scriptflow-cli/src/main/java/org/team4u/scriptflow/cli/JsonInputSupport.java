package org.team4u.scriptflow.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * JSON 输入工具，支持从文件、stdin 或内联字符串读取和校验 JSON 对象。
 *
 * @author jay.wu
 */
public final class JsonInputSupport {
    private JsonInputSupport() {
    }

    /**
     * 读取必需的 JSON 对象文件。
     * <p>
     * 支持从文件路径或 stdin（{@code "-"）读取，并校验顶层必须是 JSON 对象。
     *
     * @param output        CLI 输出工具，用于报告错误
     * @param objectMapper  JSON 序列化工具
     * @param filePath      文件路径，使用 {@code "-"} 表示从 stdin 读取
     * @param label         输入项的标签，用于错误提示
     * @return 规范化后的 JSON 字符串
     * @throws CliException 如果文件路径为空、文件不存在或内容不是有效的 JSON 对象
     */
    public static String readRequiredJsonObject(CliOutput output, ObjectMapper objectMapper, String filePath, String label) {
        if (filePath == null || filePath.isBlank()) {
            throw CliException.validation(output, label + " file path must not be empty");
        }
        return normalizeJsonObject(output, objectMapper, readText(output, filePath, label), label);
    }

    /**
     * 读取可选的 JSON 对象输入。
     * <p>
     * 支持内联 JSON 字符串或文件路径（二者互斥），省略时返回 {@code "{}"}。
     *
     * @param output        CLI 输出工具，用于报告错误
     * @param objectMapper  JSON 序列化工具
     * @param inlineValue   内联 JSON 字符串，与 filePath 互斥
     * @param filePath      文件路径，使用 {@code "-"} 表示从 stdin 读取
     * @param label         输入项的标签，用于错误提示
     * @return 规范化后的 JSON 字符串，省略时返回 {@code "{}"}
     * @throws CliException 如果同时提供了内联值和文件路径，或内容不是有效的 JSON 对象
     */
    public static String readOptionalJsonObject(CliOutput output,
                                                ObjectMapper objectMapper,
                                                String inlineValue,
                                                String filePath,
                                                String label) {
        if (hasText(inlineValue) && hasText(filePath)) {
            throw CliException.validation(output, label + " must be provided either as inline JSON or as a file, but not both");
        }
        if (hasText(inlineValue)) {
            return normalizeJsonObject(output, objectMapper, inlineValue, label);
        }
        if (hasText(filePath)) {
            return normalizeJsonObject(output, objectMapper, readText(output, filePath, label), label);
        }
        return "{}";
    }

    /**
     * 读取二进制文件内容。
     *
     * @param output   CLI 输出工具，用于报告错误
     * @param filePath 文件路径
     * @param label    输入项的标签，用于错误提示
     * @return 文件的字节数组
     * @throws CliException 如果文件路径为空或文件读取失败
     */
    public static byte[] readBinaryFile(CliOutput output, String filePath, String label) {
        if (!hasText(filePath)) {
            throw CliException.validation(output, label + " file path must not be empty");
        }
        Path path = Path.of(filePath);
        try {
            return Files.readAllBytes(path);
        } catch (IOException exception) {
            throw CliException.validation(output, "Failed to read " + label + " file: " + path);
        }
    }

    private static String readText(CliOutput output, String filePath, String label) {
        try {
            if ("-".equals(filePath)) {
                return new String(System.in.readAllBytes(), StandardCharsets.UTF_8);
            }
            return Files.readString(Path.of(filePath), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw CliException.validation(output, "Failed to read " + label + " file: " + filePath);
        }
    }

    private static String normalizeJsonObject(CliOutput output, ObjectMapper objectMapper, String rawJson, String label) {
        try {
            JsonNode parsed = objectMapper.readTree(rawJson);
            if (!(parsed instanceof ObjectNode)) {
                throw CliException.validation(output, label + " must be a JSON object at the top level");
            }
            return objectMapper.writeValueAsString(parsed);
        } catch (CliException exception) {
            throw exception;
        } catch (Exception exception) {
            throw CliException.validation(output, label + " is not valid JSON");
        }
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    /**
     * 将 JSON 字符串解析为 JsonNode 树。
     *
     * @param objectMapper JSON 序列化工具
     * @param output       CLI 输出工具，用于报告错误
     * @param json         JSON 字符串
     * @return 解析后的 JsonNode
     * @throws CliException 如果 JSON 解析失败
     */
    public static JsonNode readTree(ObjectMapper objectMapper, CliOutput output, String json) {
        try {
            return objectMapper.readTree(json);
        } catch (Exception exception) {
            throw CliException.validation(output, "Failed to parse request body JSON");
        }
    }
}
