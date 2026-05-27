package org.team4u.actiondock.browser.plugin;

import java.util.LinkedHashMap;
import java.util.Map;

final class BrowserOutputSupport {
    private BrowserOutputSupport() {
    }

    static String truncate(String value, int maxChars) {
        if (value == null || maxChars <= 0 || value.length() <= maxChars) {
            return value;
        }
        return value.substring(0, maxChars);
    }

    static boolean truncated(String value, int maxChars) {
        return value != null && maxChars > 0 && value.length() > maxChars;
    }

    @SuppressWarnings("unchecked")
    static void mark(Map<String, Object> result, String key, String source, boolean truncated, Integer originalLength) {
        Map<String, Object> outputMeta = (Map<String, Object>) result.computeIfAbsent("outputMeta", ignored -> new LinkedHashMap<String, Object>());
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("trusted", false);
        meta.put("source", source);
        meta.put("truncated", truncated);
        if (originalLength != null) {
            meta.put("originalLength", originalLength);
        }
        outputMeta.put(key, meta);
    }
}
