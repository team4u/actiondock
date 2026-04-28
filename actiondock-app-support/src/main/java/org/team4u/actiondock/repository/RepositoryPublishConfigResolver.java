package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.ConfigValue;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class RepositoryPublishConfigResolver {
    private static final Pattern PLACEHOLDER_PATTERN = Pattern.compile("\\$\\{config\\.([A-Za-z][A-Za-z0-9_.-]*)}");
    private static final Pattern CONFIG_INDEX_ACCESS_PATTERN = Pattern.compile(
            "config\\s*\\[\\s*([\"'`])([^\"'`]+)\\1\\s*]"
    );
    private static final Pattern CONFIG_GET_ACCESS_PATTERN = Pattern.compile(
            "config\\s*\\.\\s*get\\s*\\(\\s*([\"'`])([^\"'`]+)\\1\\s*\\)"
    );

    private RepositoryPublishConfigResolver() {
    }

    static PublishConfigResolution resolve(String source,
                                          List<Map<String, Object>> scheduleInputs,
                                          List<ConfigValue> configValues) {
        Map<String, ConfigValue> configsByKey = new LinkedHashMap<>();
        for (ConfigValue value : configValues == null ? List.<ConfigValue>of() : configValues) {
            if (value == null || value.getKey() == null || value.getKey().isBlank()) {
                continue;
            }
            configsByKey.put(value.getKey(), value);
        }

        LinkedHashSet<String> detectedKeys = new LinkedHashSet<>(extractSourceConfigKeys(source));
        for (Map<String, Object> scheduleInput : scheduleInputs == null ? List.<Map<String, Object>>of() : scheduleInputs) {
            detectedKeys.addAll(extractPlaceholderKeys(scheduleInput));
        }

        LinkedHashSet<String> resolvedKeys = new LinkedHashSet<>(detectedKeys);
        LinkedHashSet<String> missingKeys = new LinkedHashSet<>();
        ArrayDeque<String> queue = new ArrayDeque<>(detectedKeys);
        while (!queue.isEmpty()) {
            String key = queue.removeFirst();
            ConfigValue configValue = configsByKey.get(key);
            if (configValue == null) {
                missingKeys.add(key);
                continue;
            }
            for (String nestedKey : extractPlaceholderKeys(configValue.getValue())) {
                if (resolvedKeys.add(nestedKey)) {
                    queue.addLast(nestedKey);
                }
            }
        }

        List<ResolvedConfigValue> items = resolvedKeys.stream()
                .filter(configsByKey::containsKey)
                .map(configsByKey::get)
                .map(value -> new ResolvedConfigValue(
                        value.getKey(),
                        normalizeBlank(value.getDescription()),
                        value.isSecret(),
                        value.getValue() == null ? "" : value.getValue()
                ))
                .sorted(Comparator.comparing(ResolvedConfigValue::key))
                .toList();
        List<String> sortedMissingKeys = missingKeys.stream()
                .sorted()
                .toList();
        List<String> inferredKeys = resolvedKeys.stream()
                .sorted()
                .toList();
        return new PublishConfigResolution(items, sortedMissingKeys, inferredKeys);
    }

    static List<RepositoryCatalogService.ConfigTemplateItem> buildTemplates(PublishConfigResolution resolution,
                                                                            List<RepositoryCatalogService.RepositoryPublishConfigItem> requestedItems) {
        if (!resolution.missingKeys().isEmpty()) {
            throw new IllegalArgumentException("发布依赖的配置值不存在: " + String.join(", ", resolution.missingKeys()));
        }
        Map<String, String> requestedModes = normalizeRequestedModes(requestedItems);
        validateRequestedKeys(resolution.inferredKeys(), requestedModes.keySet());

        List<RepositoryCatalogService.ConfigTemplateItem> templates = new ArrayList<>();
        for (ResolvedConfigValue item : resolution.items()) {
            String requestedMode = requestedModes.get(item.key());
            boolean inline = !item.secret() && "INLINE".equalsIgnoreCase(requestedMode);
            templates.add(new RepositoryCatalogService.ConfigTemplateItem(
                    item.key(),
                    item.label(),
                    "string",
                    false,
                    item.secret() || !inline,
                    inline ? item.defaultValue() : null
            ));
        }
        return templates;
    }

    static List<String> extractSourceConfigKeys(String source) {
        if (source == null || source.isBlank()) {
            return List.of();
        }
        LinkedHashSet<String> keys = new LinkedHashSet<>();
        keys.addAll(extractPlaceholderKeys(source));
        collectMatches(CONFIG_INDEX_ACCESS_PATTERN.matcher(source), keys);
        collectMatches(CONFIG_GET_ACCESS_PATTERN.matcher(source), keys);
        return List.copyOf(keys);
    }

    private static void collectMatches(Matcher matcher, Set<String> target) {
        while (matcher.find()) {
            String key = normalizeBlank(matcher.group(2));
            if (key != null) {
                target.add(key);
            }
        }
    }

    private static Set<String> extractPlaceholderKeys(Object value) {
        LinkedHashSet<String> found = new LinkedHashSet<>();
        collectPlaceholderKeys(value, found);
        return found;
    }

    private static void collectPlaceholderKeys(Object value, Set<String> found) {
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
        Matcher matcher = PLACEHOLDER_PATTERN.matcher(text);
        while (matcher.find()) {
            found.add(matcher.group(1));
        }
    }

    private static Map<String, String> normalizeRequestedModes(List<RepositoryCatalogService.RepositoryPublishConfigItem> requestedItems) {
        Map<String, String> requestedModes = new LinkedHashMap<>();
        for (RepositoryCatalogService.RepositoryPublishConfigItem item : requestedItems == null
                ? List.<RepositoryCatalogService.RepositoryPublishConfigItem>of()
                : requestedItems) {
            if (item == null || item.key() == null || item.key().isBlank()) {
                throw new IllegalArgumentException("发布配置项 key 不能为空");
            }
            String key = item.key().trim();
            String mode = normalizeMode(item.publishMode());
            if (requestedModes.putIfAbsent(key, mode) != null) {
                throw new IllegalArgumentException("发布配置项重复: " + key);
            }
        }
        return requestedModes;
    }

    private static String normalizeMode(String mode) {
        String normalized = normalizeBlank(mode);
        if (normalized == null) {
            throw new IllegalArgumentException("发布配置项 publishMode 不能为空");
        }
        normalized = normalized.toUpperCase(Locale.ROOT);
        if (!"INLINE".equals(normalized) && !"PLACEHOLDER".equals(normalized)) {
            throw new IllegalArgumentException("发布配置项 publishMode 仅支持 INLINE / PLACEHOLDER");
        }
        return normalized;
    }

    private static void validateRequestedKeys(List<String> inferredKeys, Collection<String> requestedKeys) {
        LinkedHashSet<String> inferred = new LinkedHashSet<>(inferredKeys);
        LinkedHashSet<String> requested = new LinkedHashSet<>(requestedKeys);
        LinkedHashSet<String> missing = new LinkedHashSet<>(inferred);
        missing.removeAll(requested);
        if (!missing.isEmpty()) {
            throw new IllegalArgumentException("发布配置项缺失: " + String.join(", ", missing.stream().sorted().toList()));
        }
        LinkedHashSet<String> extra = new LinkedHashSet<>(requested);
        extra.removeAll(inferred);
        if (!extra.isEmpty()) {
            throw new IllegalArgumentException("发布配置项包含未检测的 key: " + String.join(", ", extra.stream().sorted().toList()));
        }
    }

    private static String normalizeBlank(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    record PublishConfigResolution(List<ResolvedConfigValue> items,
                                   List<String> missingKeys,
                                   List<String> inferredKeys) {
    }

    record ResolvedConfigValue(String key, String label, boolean secret, String defaultValue) {
    }
}
