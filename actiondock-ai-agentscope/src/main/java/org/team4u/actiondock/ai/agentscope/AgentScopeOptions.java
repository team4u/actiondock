package org.team4u.actiondock.ai.agentscope;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.function.Function;

/**
 * AgentScope 选项解析工具方法。
 *
 * @author jay.wu
 */
final class AgentScopeOptions {

    static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private AgentScopeOptions() {
    }

    static String requireText(String value, String message) {
        String text = blankToNull(value);
        if (text == null) {
            throw new IllegalArgumentException(message);
        }
        return text;
    }

    static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    static String stringOption(Map<String, Object> options, String key) {
        return toStringOrNull(options.get(key));
    }

    static String toStringOrNull(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    static Double doubleOption(Map<String, Object> options, String key) {
        return numberOption(options, key, Number::doubleValue, Double::parseDouble);
    }

    static Integer intOption(Map<String, Object> options, String key) {
        return intOption(options, key, null);
    }

    static Integer intOption(Map<String, Object> options, String key, Integer defaultValue) {
        Integer value = numberOption(options, key, Number::intValue, Integer::parseInt);
        return value != null ? value : defaultValue;
    }

    static Long longOption(Map<String, Object> options, String key) {
        return numberOption(options, key, Number::longValue, Long::parseLong);
    }

    static <T> T numberOption(Map<String, Object> options, String key,
                              Function<Number, T> fromNumber,
                              Function<String, T> fromString) {
        Object value = options.get(key);
        if (value instanceof Number number) {
            return fromNumber.apply(number);
        }
        if (value instanceof String text && !text.isBlank()) {
            return fromString.apply(text);
        }
        return null;
    }
}
