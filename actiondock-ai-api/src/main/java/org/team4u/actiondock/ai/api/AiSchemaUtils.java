package org.team4u.actiondock.ai.api;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * AI 工具输入/输出 JSON Schema 构建工具。
 * <p>
 * 提供便捷的方法来构建 AI 工具的 JSON Schema 定义，包括对象、字符串、布尔等类型 Schema 的创建，
 * 以及 Schema 选项的深拷贝操作。
 *
 * @author jay.wu
 */
public final class AiSchemaUtils {

    private AiSchemaUtils() {
    }

    /**
     * 深拷贝 Schema 选项映射。
     *
     * @param source 原始选项映射，可为 null
     * @return 深拷贝后的选项映射
     */
    public static Map<String, Map<String, Object>> copyOptions(Map<String, Map<String, Object>> source) {
        Map<String, Map<String, Object>> copy = new LinkedHashMap<>();
        if (source != null) {
            source.forEach((key, value) -> copy.put(key, value == null ? new LinkedHashMap<>() : new LinkedHashMap<>(value)));
        }
        return copy;
    }

    /**
     * 构建 object 类型的 JSON Schema。
     *
     * @param properties 对象属性定义，可为 null
     * @return object 类型的 Schema 映射
     */
    public static Map<String, Object> objectSchema(Map<String, Object> properties) {
        return Map.of("type", "object", "properties", properties == null ? Map.of() : properties);
    }

    /**
     * 构建无描述的 string 类型 JSON Schema。
     *
     * @return string 类型的 Schema 映射
     */
    public static Map<String, Object> stringSchema() {
        return Map.of("type", "string");
    }

    /**
     * 构建带描述的 string 类型 JSON Schema。
     *
     * @param description 字段描述
     * @return 包含描述的 string 类型 Schema 映射
     */
    public static Map<String, Object> stringSchema(String description) {
        return Map.of("type", "string", "description", description);
    }

    /**
     * 构建 boolean 类型的 JSON Schema。
     *
     * @return boolean 类型的 Schema 映射
     */
    public static Map<String, Object> booleanSchema() {
        return Map.of("type", "boolean");
    }
}
