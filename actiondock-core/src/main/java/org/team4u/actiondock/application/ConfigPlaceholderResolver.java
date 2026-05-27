package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.ConfigValue;
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
    private static final String REDACTED_VALUE = "********";

    private final ConfigValueRepository configValueRepository;

    record ResolvedMapView(Map<String, Object> resolved, Map<String, Object> redacted) {
    }

    private record ConfigValueSnapshot(Map<String, String> resolvedValues, Map<String, String> redactedValues) {
    }

    ConfigPlaceholderResolver(ConfigValueRepository configValueRepository) {
        this.configValueRepository = configValueRepository;
    }

    Map<String, String> snapshot() {
        return snapshotViews().resolvedValues();
    }

    ResolvedMapView resolveMapView(Map<String, Object> source) {
        ConfigValueSnapshot snapshot = snapshotViews();
        return new ResolvedMapView(
                resolveMap(source, snapshot.resolvedValues()),
                resolveMap(source, snapshot.redactedValues())
        );
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

    private ConfigValueSnapshot snapshotViews() {
        Map<String, ConfigValue> rawValues = loadRawValues();
        Map<String, String> resolved = new LinkedHashMap<>();
        Map<String, String> redacted = new LinkedHashMap<>();
        rawValues.keySet().forEach(key -> resolveValue(key, rawValues, resolved, redacted, new LinkedHashSet<>()));
        return new ConfigValueSnapshot(
                Collections.unmodifiableMap(new LinkedHashMap<>(resolved)),
                Collections.unmodifiableMap(new LinkedHashMap<>(redacted))
        );
    }

    private String resolveValue(String key,
                                Map<String, ConfigValue> rawValues,
                                Map<String, String> resolvedValues,
                                Map<String, String> redactedValues,
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
        Map<String, String> lazyResolvedLookup = new LinkedHashMap<>() {
            @Override
            public String get(Object k) {
                String existing = resolvedValues.get(k);
                if (existing != null) {
                    return existing;
                }
                if (!(k instanceof String keyText) || !rawValues.containsKey(k)) {
                    return null;
                }
                return resolveValue(keyText, rawValues, resolvedValues, redactedValues, new LinkedHashSet<>(stack));
            }
        };
        String resolved = resolveText(rawValues.get(key).getValue(), lazyResolvedLookup);
        String redacted = rawValues.get(key).isSecret()
                ? REDACTED_VALUE
                : resolveText(rawValues.get(key).getValue(), new LinkedHashMap<>() {
                    @Override
                    public String get(Object k) {
                        String existing = redactedValues.get(k);
                        if (existing != null) {
                            return existing;
                        }
                        if (!(k instanceof String keyText) || !rawValues.containsKey(k)) {
                            return null;
                        }
                        resolveValue(keyText, rawValues, resolvedValues, redactedValues, new LinkedHashSet<>(stack));
                        return redactedValues.get(keyText);
                    }
                });
        resolvedValues.put(key, resolved);
        redactedValues.put(key, redacted);
        stack.remove(key);
        return resolved;
    }

    private Map<String, ConfigValue> loadRawValues() {
        Map<String, ConfigValue> rawValues = new LinkedHashMap<>();
        configValueRepository.findAll().stream()
                .sorted(Comparator.comparing(item -> item.getKey()))
                .forEach(item -> rawValues.put(item.getKey(), item.copy()));
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
