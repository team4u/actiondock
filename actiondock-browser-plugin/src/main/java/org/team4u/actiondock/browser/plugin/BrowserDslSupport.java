package org.team4u.actiondock.browser.plugin;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class BrowserDslSupport {
    private BrowserDslSupport() {
    }

    static Map<String, Object> merge(Map<String, Object> base, Object... keyValues) {
        Map<String, Object> result = new LinkedHashMap<>(base);
        for (int i = 0; i + 1 < keyValues.length; i += 2) {
            Object value = keyValues[i + 1];
            if (value != null) {
                result.put(String.valueOf(keyValues[i]), value);
            }
        }
        return result;
    }

    static void copyIfPresent(Map<String, Object> from, Map<String, Object> to, String... keys) {
        for (String key : keys) {
            if (Args.has(from, key)) {
                to.put(key, from.get(key));
            }
        }
    }

    static String normalizeOp(Map<String, Object> args, String defaultOp) {
        return Args.optionalString(args, "op", defaultOp).trim();
    }

    static List<String> csv(String value) {
        if (Args.isBlank(value)) {
            return List.of();
        }
        return java.util.Arrays.stream(value.split(","))
                .map(String::trim)
                .filter(item -> !item.isBlank())
                .toList();
    }
}
