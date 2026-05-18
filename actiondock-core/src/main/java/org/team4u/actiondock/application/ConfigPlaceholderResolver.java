package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.port.ConfigValueRepository;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 配置值占位符解析器，递归解析 ${config.xxx} 格式的占位符并检测循环引用。
 *
 * @author jay.wu
 */
class ConfigPlaceholderResolver {

    private static final Pattern PLACEHOLDER_PATTERN = Pattern.compile("\\$\\{config\\.([A-Za-z][A-Za-z0-9_.-]*)}");

    private final ConfigValueRepository configValueRepository;

    ConfigPlaceholderResolver(ConfigValueRepository configValueRepository) {
        this.configValueRepository = configValueRepository;
    }

    Map<String, String> snapshot() {
        Map<String, String> rawValues = loadRawValues();
        Map<String, String> resolved = new LinkedHashMap<>();
        rawValues.keySet().forEach(key -> resolveValue(key, rawValues, resolved, new LinkedHashSet<>()));
        return Collections.unmodifiableMap(new LinkedHashMap<>(resolved));
    }

    Map<String, Object> resolveMap(Map<String, Object> source, Map<String, String> configValues) {
        if (source == null) {
            return new LinkedHashMap<>();
        }
        Map<String, Object> resolved = new LinkedHashMap<>();
        source.forEach((key, item) -> resolved.put(key, resolveObject(item, configValues)));
        return resolved;
    }

    Object resolveObject(Object value, Map<String, String> configValues) {
        if (value instanceof Map<?, ?> mapValue) {
            Map<String, Object> resolved = new LinkedHashMap<>();
            mapValue.forEach((key, item) -> resolved.put(String.valueOf(key), resolveObject(item, configValues)));
            return resolved;
        }
        if (value instanceof List<?> listValue) {
            List<Object> resolved = new ArrayList<>();
            listValue.forEach(item -> resolved.add(resolveObject(item, configValues)));
            return resolved;
        }
        if (value instanceof String text) {
            return resolveText(text, configValues);
        }
        return value;
    }

    String resolveText(String value, Map<String, String> configValues) {
        if (value == null || value.isEmpty()) {
            return value == null ? "" : value;
        }
        Matcher matcher = PLACEHOLDER_PATTERN.matcher(value);
        StringBuilder result = new StringBuilder();
        while (matcher.find()) {
            String key = matcher.group(1);
            String replacement = configValues.get(key);
            if (replacement == null) {
                throw missingConfigValue(key);
            }
            matcher.appendReplacement(result, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(result);
        return result.toString();
    }

    private String resolveValue(String key,
                                Map<String, String> rawValues,
                                Map<String, String> resolvedValues,
                                LinkedHashSet<String> stack) {
        String cached = resolvedValues.get(key);
        if (cached != null) {
            return cached;
        }
        if (!rawValues.containsKey(key)) {
            throw missingConfigValue(key);
        }
        if (!stack.add(key)) {
            List<String> cycle = new ArrayList<>(stack);
            cycle.add(key);
            throw new IllegalArgumentException("配置值引用存在循环: " + String.join(" -> ", cycle));
        }
        Map<String, String> lazyLookup = new LinkedHashMap<>(rawValues) {
            @Override
            public String get(Object k) {
                String existing = resolvedValues.get(k);
                if (existing != null) {
                    return existing;
                }
                if (!(k instanceof String keyText) || !rawValues.containsKey(k)) {
                    return null;
                }
                return resolveValue(keyText, rawValues, resolvedValues, new LinkedHashSet<>(stack));
            }
        };
        String resolved = resolveText(rawValues.get(key), lazyLookup);
        resolvedValues.put(key, resolved);
        stack.remove(key);
        return resolved;
    }

    private Map<String, String> loadRawValues() {
        Map<String, String> rawValues = new LinkedHashMap<>();
        configValueRepository.findAll().stream()
                .sorted(Comparator.comparing(item -> item.getKey()))
                .forEach(item -> rawValues.put(item.getKey(), item.getValue() == null ? "" : item.getValue()));
        return rawValues;
    }

    private static ActionDockException missingConfigValue(String key) {
        return ActionDockException.notFound(
                ActionDockErrorCodes.CONFIG_VALUE_NOT_FOUND,
                "配置值不存在: " + key,
                Map.of("key", key)
        );
    }
}
