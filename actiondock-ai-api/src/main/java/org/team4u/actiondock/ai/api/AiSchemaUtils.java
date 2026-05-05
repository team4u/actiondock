package org.team4u.actiondock.ai.api;

import java.util.Map;

/**
 * AI 工具输入/输出 JSON Schema 构建工具。
 */
public final class AiSchemaUtils {

    private AiSchemaUtils() {
    }

    public static Map<String, Object> objectSchema(Map<String, Object> properties) {
        return Map.of("type", "object", "properties", properties == null ? Map.of() : properties);
    }

    public static Map<String, Object> stringSchema() {
        return Map.of("type", "string");
    }

    public static Map<String, Object> stringSchema(String description) {
        return Map.of("type", "string", "description", description);
    }

    public static Map<String, Object> booleanSchema() {
        return Map.of("type", "boolean");
    }
}
