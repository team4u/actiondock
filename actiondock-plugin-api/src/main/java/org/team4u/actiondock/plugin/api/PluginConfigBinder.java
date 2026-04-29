package org.team4u.actiondock.plugin.api;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonMappingException;

import java.util.Collections;
import java.util.Map;
import java.util.stream.Collectors;

public final class PluginConfigBinder {
    private PluginConfigBinder() {
    }

    /**
     * 将插件配置 Map 绑定到指定的 Java 类型。
     * <p>
     * 通过 Jackson 反序列化将配置字典转换为目标类型实例。
     * 调用方需在调用此方法前完成平台默认值的合并。
     *
     * @param source 插件配置字典，可以为 null（视为空配置）
     * @param type   目标 Java 类型
     * @param <T>    目标类型泛型
     * @return 绑定后的配置对象实例
     * @throws IllegalArgumentException 如果 type 为 null，或配置无法反序列化为目标类型
     */
    public static <T> T bind(Map<String, Object> source, Class<T> type) {
        if (type == null) {
            throw new IllegalArgumentException("type must not be null");
        }

        try {
            return PluginObjectMappers.DEFAULT.readValue(
                    PluginObjectMappers.DEFAULT.writeValueAsString(source == null ? Collections.emptyMap() : source),
                    type
            );
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException(buildBindingErrorMessage(type, exception), exception);
        }
    }

    private static String buildBindingErrorMessage(Class<?> type, JsonProcessingException exception) {
        if (exception instanceof JsonMappingException mappingException) {
            String path = mappingException.getPath().stream()
                    .map(reference -> {
                        if (reference.getFieldName() != null) {
                            return reference.getFieldName();
                        }
                        if (reference.getIndex() >= 0) {
                            return "[" + reference.getIndex() + "]";
                        }
                        return null;
                    })
                    .filter(segment -> segment != null && !segment.isBlank())
                    .collect(Collectors.joining("."));
            if (!path.isBlank()) {
                return "Cannot bind plugin config to " + type.getName() + " at " + path + ": "
                        + mappingException.getOriginalMessage();
            }
        }
        return "Cannot bind plugin config to " + type.getName() + ": " + exception.getOriginalMessage();
    }
}
