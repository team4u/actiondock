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

    public static String readRequiredJsonObject(CliOutput output, ObjectMapper objectMapper, String filePath, String label) {
        if (filePath == null || filePath.isBlank()) {
            throw CliException.validation(output, label + " file path must not be empty");
        }
        return normalizeJsonObject(output, objectMapper, readText(output, filePath, label), label);
    }

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

    public static JsonNode readTree(ObjectMapper objectMapper, CliOutput output, String json) {
        try {
            return objectMapper.readTree(json);
        } catch (Exception exception) {
            throw CliException.validation(output, "Failed to parse request body JSON");
        }
    }
}
