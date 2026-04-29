package org.team4u.actiondock.application;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Schema 值拷贝工具类，提供 Map 结构的深拷贝功能。
 * <p>
 * 用于确保领域对象中的 Map 类型字段在存储和传递过程中保持独立性，
 * 避免意外的引用共享导致的修改冲突。
 *
 * @author jay.wu
 */
public final class SchemaValueCopier {
    private SchemaValueCopier() {
    }

    /**
     * 拷贝 Map 结构，支持嵌套的 Map 和 List。
     *
     * @param value 要拷贝的 Map，可以为 null
     * @return 拷贝后的新 Map，如果是 null 则返回空 Map
     */
    public static Map<String, Object> copyMap(Map<String, Object> value) {
        if (value == null) {
            return new LinkedHashMap<>();
        }
        Map<String, Object> result = new LinkedHashMap<>();
        value.forEach((key, item) -> result.put(key, copyValue(item)));
        return result;
    }

    /**
     * 递归拷贝单个值。
     * <p>
     * 如果值是 Map 或 List，则递归拷贝其内容；
     * 否则直接返回原始值（基本类型或不可变对象）。
     *
     * @param value 要拷贝的值
     * @return 拷贝后的值
     */
    private static Object copyValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            map.forEach((key, item) -> result.put(String.valueOf(key), copyValue(item)));
            return result;
        }
        if (value instanceof List<?> list) {
            List<Object> result = new ArrayList<>(list.size());
            for (Object item : list) {
                result.add(copyValue(item));
            }
            return result;
        }
        return value;
    }
}
