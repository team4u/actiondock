package org.team4u.actiondock.application;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Map 值转换工具类，将脚本执行结果标准化为 Map 结构。
 *
 * @author jay.wu
 */
public final class MapValueConverter {

    private MapValueConverter() {
    }

    /**
     * 将任意结果转换为 Map。
     * <p>
     * 如果结果已经是 Map，则将键转换为 String；
     * 如果结果为 null，返回空 Map；
     * 其他类型包装为 {"result": result}。
     *
     * @param result 脚本执行结果
     * @return 标准化后的 Map
     */
    public static Map<String, Object> toResultMap(Object result) {
        if (result == null) {
            return new LinkedHashMap<>();
        }
        if (result instanceof Map<?, ?> map) {
            Map<String, Object> values = new LinkedHashMap<>();
            map.forEach((k, v) -> values.put(String.valueOf(k), v));
            return values;
        }
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("result", result);
        return values;
    }
}
