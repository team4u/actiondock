package org.team4u.actiondock.application;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 执行入参归一化工具。
 * <p>
 * 递归遍历 Map / List 结构，将脚本运行时产生的非 String 字符串类型
 * （例如 Groovy GString）统一转换为 Java String，避免 schema 严格校验时
 * 因运行时实现差异而误判。
 */
public final class ExecutionInputNormalizer {
    private ExecutionInputNormalizer() {
    }

    static Map<String, Object> normalizeMap(Map<String, Object> input) {
        if (input == null) {
            return new LinkedHashMap<>();
        }
        Map<String, Object> normalized = new LinkedHashMap<>();
        input.forEach((key, value) -> normalized.put(String.valueOf(key), normalizeValue(value)));
        return normalized;
    }

    private static Object normalizeValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> normalized = new LinkedHashMap<>();
            map.forEach((key, item) -> normalized.put(String.valueOf(key), normalizeValue(item)));
            return normalized;
        }
        if (value instanceof List<?> list) {
            List<Object> normalized = new ArrayList<>(list.size());
            for (Object item : list) {
                normalized.add(normalizeValue(item));
            }
            return normalized;
        }
        if (value instanceof CharSequence sequence && !(value instanceof String)) {
            return sequence.toString();
        }
        return value;
    }
}
