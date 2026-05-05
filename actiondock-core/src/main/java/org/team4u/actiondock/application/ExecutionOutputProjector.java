package org.team4u.actiondock.application;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 执行输出投影器，根据输出模式（outputSchema）过滤脚本执行结果。
 * <p>
 * 仅保留模式中声明的字段，实现输出字段的裁剪和规范化。
 *
 * @author jay.wu
 */
public class ExecutionOutputProjector {
    private ExecutionOutputProjector() {
    }

    /**
     * 根据输出模式（outputSchema）投影过滤原始执行结果。
     * <p>
     * 仅保留模式中 properties 声明的字段，未在模式中定义的字段将被裁剪。
     * 如果模式为空或不含 properties，则返回原始输出的完整拷贝。
     *
     * @param rawOutput    脚本执行的原始输出
     * @param outputSchema 输出模式定义，遵循 JSON Schema 格式
     * @return 经过投影过滤后的输出结果
     */
    public static Map<String, Object> project(Map<String, Object> rawOutput, Map<String, Object> outputSchema) {
        Map<String, Object> source = rawOutput == null ? new LinkedHashMap<>() : new LinkedHashMap<>(rawOutput);
        Map<String, Object> properties = propertiesOf(outputSchema);
        if (properties.isEmpty()) {
            return source;
        }

        Map<String, Object> projected = new LinkedHashMap<>();
        properties.forEach((name, ignored) -> {
            if (source.containsKey(name)) {
                projected.put(name, source.get(name));
            }
        });
        return projected;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> propertiesOf(Map<String, Object> outputSchema) {
        if (outputSchema == null || outputSchema.isEmpty()) {
            return Map.of();
        }

        Object properties = outputSchema.get("properties");
        if (!(properties instanceof Map<?, ?> propertyMap) || propertyMap.isEmpty()) {
            return Map.of();
        }

        Map<String, Object> values = new LinkedHashMap<>();
        propertyMap.forEach((key, value) -> values.put(String.valueOf(key), value));
        return values;
    }
}
