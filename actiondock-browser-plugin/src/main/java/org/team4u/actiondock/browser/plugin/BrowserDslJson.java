package org.team4u.actiondock.browser.plugin;

import org.team4u.actiondock.plugin.api.PluginObjectMappers;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class BrowserDslJson {
    private BrowserDslJson() {
    }

    static Map<String, Object> object(Map<String, Object> args, String key) {
        String value = Args.optionalString(args, key, null);
        if (Args.isBlank(value)) {
            return Map.of();
        }
        try {
            Object parsed = PluginObjectMappers.DEFAULT.readValue(value, Object.class);
            if (parsed instanceof Map<?, ?> map) {
                Map<String, Object> result = new LinkedHashMap<>();
                map.forEach((itemKey, itemValue) -> {
                    if (itemKey != null) {
                        result.put(String.valueOf(itemKey), itemValue);
                    }
                });
                return result;
            }
            throw new IllegalArgumentException(key + " must be a JSON object");
        } catch (Exception exception) {
            throw new IllegalArgumentException(key + " is not valid JSON: " + exception.getMessage(), exception);
        }
    }

    static List<Map<String, Object>> objectList(Map<String, Object> args, String key) {
        String value = Args.optionalString(args, key, null);
        if (Args.isBlank(value)) {
            return List.of();
        }
        try {
            Object parsed = PluginObjectMappers.DEFAULT.readValue(value, Object.class);
            if (!(parsed instanceof List<?> list)) {
                throw new IllegalArgumentException(key + " must be a JSON array");
            }
            return list.stream()
                    .map(item -> {
                        if (!(item instanceof Map<?, ?> map)) {
                            throw new IllegalArgumentException(key + " items must be JSON objects");
                        }
                        Map<String, Object> result = new LinkedHashMap<>();
                        map.forEach((itemKey, itemValue) -> {
                            if (itemKey != null) {
                                result.put(String.valueOf(itemKey), itemValue);
                            }
                        });
                        return result;
                    })
                    .toList();
        } catch (Exception exception) {
            throw new IllegalArgumentException(key + " is not valid JSON: " + exception.getMessage(), exception);
        }
    }

    static Object value(Map<String, Object> args, String key) {
        String value = Args.optionalString(args, key, null);
        if (Args.isBlank(value)) {
            return null;
        }
        try {
            return PluginObjectMappers.DEFAULT.readValue(value, Object.class);
        } catch (Exception exception) {
            throw new IllegalArgumentException(key + " is not valid JSON: " + exception.getMessage(), exception);
        }
    }
}
