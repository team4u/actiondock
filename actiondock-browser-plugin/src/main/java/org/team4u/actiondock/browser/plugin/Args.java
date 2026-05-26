package org.team4u.actiondock.browser.plugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

final class Args {
    private Args() {
    }

    static String requiredString(Map<String, Object> args, String key) {
        String value = optionalString(args, key, null);
        if (isBlank(value)) {
            throw new IllegalArgumentException(key + " is required");
        }
        return value;
    }

    static boolean has(Map<String, Object> args, String key) {
        return args != null && args.containsKey(key) && args.get(key) != null;
    }

    static String optionalString(Map<String, Object> args, String key, String defaultValue) {
        Object value = args == null ? null : args.get(key);
        if (value == null) {
            return defaultValue;
        }
        String text = String.valueOf(value);
        return text.isBlank() ? defaultValue : text;
    }

    static boolean optionalBoolean(Map<String, Object> args, String key, boolean defaultValue) {
        Object value = args == null ? null : args.get(key);
        if (value == null) {
            return defaultValue;
        }
        if (value instanceof Boolean bool) {
            return bool;
        }
        return Boolean.parseBoolean(String.valueOf(value));
    }

    static int optionalInt(Map<String, Object> args, String key, int defaultValue) {
        Object value = args == null ? null : args.get(key);
        if (value == null || String.valueOf(value).isBlank()) {
            return defaultValue;
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        return Integer.parseInt(String.valueOf(value));
    }

    static Double optionalDouble(Map<String, Object> args, String key) {
        Object value = args == null ? null : args.get(key);
        if (value == null || String.valueOf(value).isBlank()) {
            return null;
        }
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        return Double.parseDouble(String.valueOf(value));
    }

    static double requiredDouble(Map<String, Object> args, String key) {
        Double value = optionalDouble(args, key);
        if (value == null) {
            throw new IllegalArgumentException(key + " is required");
        }
        return value;
    }

    static Map<String, Object> optionalMap(Map<String, Object> args, String key) {
        Object value = args == null ? null : args.get(key);
        if (value instanceof Map<?, ?> map) {
            return toStringObjectMap(map);
        }
        return Map.of();
    }

    static List<Map<String, Object>> requiredMapList(Map<String, Object> args, String key) {
        Object value = args == null ? null : args.get(key);
        if (!(value instanceof List<?> list)) {
            throw new IllegalArgumentException(key + " must be an array");
        }
        List<Map<String, Object>> result = new ArrayList<>();
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> map)) {
                throw new IllegalArgumentException(key + " items must be objects");
            }
            result.add(toStringObjectMap(map));
        }
        return result;
    }

    static List<String> optionalStringList(Map<String, Object> args, String key) {
        Object value = args == null ? null : args.get(key);
        if (value == null) {
            return List.of();
        }
        if (!(value instanceof List<?> list)) {
            throw new IllegalArgumentException(key + " must be an array");
        }
        return list.stream()
                .filter(item -> item != null && !String.valueOf(item).isBlank())
                .map(String::valueOf)
                .toList();
    }

    static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static Map<String, Object> toStringObjectMap(Map<?, ?> map) {
        java.util.LinkedHashMap<String, Object> result = new java.util.LinkedHashMap<>();
        map.forEach((key, value) -> {
            if (key != null) {
                result.put(String.valueOf(key), value);
            }
        });
        return result;
    }
}
