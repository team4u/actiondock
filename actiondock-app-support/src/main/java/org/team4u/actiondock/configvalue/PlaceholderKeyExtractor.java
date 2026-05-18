package org.team4u.actiondock.configvalue;

import org.team4u.actiondock.shared.NormalizeUtils;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 配置占位符键提取工具，从字符串和嵌套结构中提取 {@code ${config.xxx}} 引用。
 *
 * @author jay.wu
 */
public final class PlaceholderKeyExtractor {

    private static final Pattern PLACEHOLDER_PATTERN = Pattern.compile("\\$\\{config\\.([A-Za-z][A-Za-z0-9_.-]*)}");

    private PlaceholderKeyExtractor() {
    }

    public static Set<String> extractPlaceholderKeys(String value) {
        if (NormalizeUtils.isBlank(value)) {
            return Set.of();
        }
        Set<String> keys = new LinkedHashSet<>();
        java.util.regex.Matcher matcher = PLACEHOLDER_PATTERN.matcher(value);
        while (matcher.find()) {
            keys.add(matcher.group(1));
        }
        return keys;
    }

    public static void collectPlaceholderKeys(Object value, Set<String> found) {
        if (value instanceof Map<?, ?> map) {
            for (Object item : map.values()) {
                collectPlaceholderKeys(item, found);
            }
            return;
        }
        if (value instanceof Iterable<?> iterable) {
            for (Object item : iterable) {
                collectPlaceholderKeys(item, found);
            }
            return;
        }
        if (!(value instanceof String text) || text.isBlank()) {
            return;
        }
        found.addAll(extractPlaceholderKeys(text));
    }

    public static Set<String> filterPlaceholderKeys(Object value, Collection<String> keys) {
        Set<String> found = new LinkedHashSet<>();
        collectPlaceholderKeys(value, found);
        found.retainAll(keys instanceof Set<?> ? (Set<String>) keys : new LinkedHashSet<>(keys));
        return found;
    }

    public static boolean containsPlaceholderKey(Object value, String key) {
        Set<String> found = new LinkedHashSet<>();
        collectPlaceholderKeys(value, found);
        return found.contains(key);
    }

}
