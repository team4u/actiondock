package org.team4u.actiondock.storage.jpa.adapter;

import org.team4u.actiondock.domain.port.JsonCodec;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * JPA 适配层 JSON 工具方法，消除各适配器中的重复代码。
 *
 * @author jay.wu
 */
final class JpaJsonSupport {

    private JpaJsonSupport() {
    }

    /**
     * 安全地将 JSON 字符串反序列化为指定类型，空白或 null 输入返回 null。
     */
    static <T> T read(JsonCodec jsonCodec, String json, Class<T> type) {
        return json == null || json.isBlank() ? null : jsonCodec.read(json, type);
    }

    /**
     * 将 JSON 反序列化为嵌套 Map 结构（工具选项专用）。
     */
    @SuppressWarnings("unchecked")
    static Map<String, Map<String, Object>> readToolOptions(JsonCodec jsonCodec, String json) {
        Map<String, Map<String, Object>> options = new LinkedHashMap<>();
        jsonCodec.readMap(json).forEach((key, value) -> {
            if (value instanceof Map<?, ?> map) {
                options.put(key, new LinkedHashMap<>((Map<String, Object>) map));
            }
        });
        return options;
    }
}
