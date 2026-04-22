package org.team4u.scriptflow.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class JsonInputSupport {
    private JsonInputSupport() {
    }

    public static String readRequiredJsonObject(CliOutput output, ObjectMapper objectMapper, String filePath, String label) {
        if (filePath == null || filePath.isBlank()) {
            throw CliException.validation(output, label + " 文件不能为空");
        }
        return normalizeJsonObject(output, objectMapper, readText(output, filePath, label), label);
    }

    public static String readOptionalJsonObject(CliOutput output,
                                                ObjectMapper objectMapper,
                                                String inlineValue,
                                                String filePath,
                                                String label) {
        if (hasText(inlineValue) && hasText(filePath)) {
            throw CliException.validation(output, label + " 只能通过内联 JSON 或文件提供其一");
        }
        if (hasText(inlineValue)) {
            return normalizeJsonObject(output, objectMapper, inlineValue, label);
        }
        if (hasText(filePath)) {
            return normalizeJsonObject(output, objectMapper, readText(output, filePath, label), label);
        }
        return "{}";
    }

    public static byte[] readBinaryFile(CliOutput output, String filePath, String label) {
        if (!hasText(filePath)) {
            throw CliException.validation(output, label + " 文件不能为空");
        }
        Path path = Path.of(filePath);
        try {
            return Files.readAllBytes(path);
        } catch (IOException exception) {
            throw CliException.validation(output, label + " 文件读取失败: " + path);
        }
    }

    private static String readText(CliOutput output, String filePath, String label) {
        try {
            if ("-".equals(filePath)) {
                return new String(System.in.readAllBytes(), StandardCharsets.UTF_8);
            }
            return Files.readString(Path.of(filePath), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw CliException.validation(output, label + " 文件读取失败: " + filePath);
        }
    }

    private static String normalizeJsonObject(CliOutput output, ObjectMapper objectMapper, String rawJson, String label) {
        try {
            JsonNode parsed = objectMapper.readTree(rawJson);
            if (!(parsed instanceof ObjectNode)) {
                throw CliException.validation(output, label + " 顶层必须是 JSON 对象");
            }
            return objectMapper.writeValueAsString(parsed);
        } catch (CliException exception) {
            throw exception;
        } catch (Exception exception) {
            throw CliException.validation(output, label + " 不是合法 JSON");
        }
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    public static JsonNode readTree(ObjectMapper objectMapper, CliOutput output, String json) {
        try {
            return objectMapper.readTree(json);
        } catch (Exception exception) {
            throw CliException.validation(output, "请求体 JSON 解析失败");
        }
    }
}
