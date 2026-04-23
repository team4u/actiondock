package org.team4u.scriptflow.application;

import org.team4u.scriptflow.domain.model.ConfigValue;
import org.team4u.scriptflow.domain.port.ConfigValueRepository;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 全局配置值应用服务，负责 CRUD 和运行时占位符解析。
 * <p>
 * 支持使用 {@code ${config.some.key}} 在字符串、对象和数组结构中引用全局配置值。
 *
 * @author jay.wu
 */
public class ConfigValueApplicationService {
    private static final Pattern KEY_PATTERN = Pattern.compile("[A-Za-z][A-Za-z0-9_.-]*");
    private static final Pattern PLACEHOLDER_PATTERN = Pattern.compile("\\$\\{config\\.([A-Za-z][A-Za-z0-9_.-]*)}");
    private static final ConfigValueApplicationService DISABLED = new ConfigValueApplicationService();

    private final ConfigValueRepository configValueRepository;
    private final boolean enabled;

    private ConfigValueApplicationService() {
        this.configValueRepository = null;
        this.enabled = false;
    }

    public ConfigValueApplicationService(ConfigValueRepository configValueRepository) {
        this.configValueRepository = Objects.requireNonNull(configValueRepository);
        this.enabled = true;
    }

    public static ConfigValueApplicationService disabled() {
        return DISABLED;
    }

    public List<ConfigValue> list() {
        if (!enabled) {
            return List.of();
        }
        return configValueRepository.findAll().stream()
                .sorted((left, right) -> left.getKey().compareTo(right.getKey()))
                .map(this::copy)
                .toList();
    }

    public ConfigValue get(String key) {
        ensureEnabled();
        return copy(requireExisting(normalizeKey(key)));
    }

    public ConfigValue create(ConfigValue configValue) {
        ensureEnabled();
        ConfigValue normalized = normalizeForCreate(configValue);
        if (configValueRepository.findByKey(normalized.getKey()).isPresent()) {
            throw new IllegalArgumentException("配置值已存在: " + normalized.getKey());
        }
        LocalDateTime now = LocalDateTime.now();
        normalized.setCreatedAt(now).setUpdatedAt(now);
        return copy(configValueRepository.save(normalized));
    }

    public ConfigValue update(String key, ConfigValue configValue) {
        ensureEnabled();
        String normalizedKey = normalizeKey(key);
        ConfigValue existing = requireExisting(normalizedKey);
        ConfigValue normalized = normalizeForUpdate(normalizedKey, configValue);
        normalized.setCreatedAt(existing.getCreatedAt()).setUpdatedAt(LocalDateTime.now());
        return copy(configValueRepository.save(normalized));
    }

    public void delete(String key) {
        ensureEnabled();
        String normalizedKey = normalizeKey(key);
        requireExisting(normalizedKey);
        configValueRepository.deleteByKey(normalizedKey);
    }

    public Map<String, String> snapshot() {
        if (!enabled) {
            return Map.of();
        }
        Map<String, String> rawValues = loadRawValues();
        Map<String, String> resolved = new LinkedHashMap<>();
        rawValues.keySet().forEach(key -> resolveValue(key, rawValues, resolved, new LinkedHashSet<>()));
        return Collections.unmodifiableMap(new LinkedHashMap<>(resolved));
    }

    public Map<String, Object> resolveMap(Map<String, Object> source) {
        if (source == null) {
            return new LinkedHashMap<>();
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> resolved = (Map<String, Object>) resolveObject(source, snapshot());
        return resolved;
    }

    public Object resolveObject(Object value) {
        return resolveObject(value, snapshot());
    }

    public String resolveText(String value) {
        return resolveText(value, snapshot());
    }

    private Object resolveObject(Object value, Map<String, String> configValues) {
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

    private String resolveText(String value, Map<String, String> configValues) {
        if (value == null || value.isEmpty()) {
            return value == null ? "" : value;
        }
        Matcher matcher = PLACEHOLDER_PATTERN.matcher(value);
        StringBuilder result = new StringBuilder();
        while (matcher.find()) {
            String key = matcher.group(1);
            String replacement = configValues.get(key);
            if (replacement == null) {
                throw new IllegalArgumentException("配置值不存在: " + key);
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
            throw new IllegalArgumentException("配置值不存在: " + key);
        }
        if (!stack.add(key)) {
            List<String> cycle = new ArrayList<>(stack);
            cycle.add(key);
            throw new IllegalArgumentException("配置值引用存在循环: " + String.join(" -> ", cycle));
        }
        String resolved = resolveText(rawValues.get(key), new LazyResolvedConfigMap(rawValues, resolvedValues, stack));
        resolvedValues.put(key, resolved);
        stack.remove(key);
        return resolved;
    }

    private Map<String, String> loadRawValues() {
        Map<String, String> rawValues = new LinkedHashMap<>();
        configValueRepository.findAll().stream()
                .sorted((left, right) -> left.getKey().compareTo(right.getKey()))
                .forEach(item -> rawValues.put(item.getKey(), item.getValue() == null ? "" : item.getValue()));
        return rawValues;
    }

    private ConfigValue normalizeForCreate(ConfigValue configValue) {
        if (configValue == null) {
            throw new IllegalArgumentException("配置值不能为空");
        }
        return new ConfigValue()
                .setKey(normalizeKey(configValue.getKey()))
                .setValue(configValue.getValue())
                .setDescription(normalizeDescription(configValue.getDescription()));
    }

    private ConfigValue normalizeForUpdate(String key, ConfigValue configValue) {
        if (configValue == null) {
            throw new IllegalArgumentException("配置值不能为空");
        }
        if (configValue.getKey() != null && !configValue.getKey().isBlank() && !key.equals(normalizeKey(configValue.getKey()))) {
            throw new IllegalArgumentException("不支持修改配置值 key");
        }
        return new ConfigValue()
                .setKey(key)
                .setValue(configValue.getValue())
                .setDescription(normalizeDescription(configValue.getDescription()));
    }

    private String normalizeKey(String key) {
        if (key == null || key.isBlank()) {
            throw new IllegalArgumentException("配置值 key 不能为空");
        }
        String normalized = key.trim();
        if (!KEY_PATTERN.matcher(normalized).matches()) {
            throw new IllegalArgumentException("配置值 key 格式不合法: " + normalized);
        }
        return normalized;
    }

    private String normalizeDescription(String description) {
        if (description == null || description.isBlank()) {
            return null;
        }
        return description.trim();
    }

    private ConfigValue requireExisting(String key) {
        return configValueRepository.findByKey(key)
                .orElseThrow(() -> new IllegalArgumentException("配置值不存在: " + key));
    }

    private ConfigValue copy(ConfigValue source) {
        return new ConfigValue()
                .setKey(source.getKey())
                .setValue(source.getValue())
                .setDescription(source.getDescription())
                .setCreatedAt(source.getCreatedAt())
                .setUpdatedAt(source.getUpdatedAt());
    }

    private void ensureEnabled() {
        if (!enabled) {
            throw new IllegalStateException("配置值服务未启用");
        }
    }

    private final class LazyResolvedConfigMap extends LinkedHashMap<String, String> {
        private final Map<String, String> rawValues;
        private final Map<String, String> resolvedValues;
        private final LinkedHashSet<String> stack;

        private LazyResolvedConfigMap(Map<String, String> rawValues,
                                      Map<String, String> resolvedValues,
                                      LinkedHashSet<String> stack) {
            this.rawValues = rawValues;
            this.resolvedValues = resolvedValues;
            this.stack = stack;
        }

        @Override
        public String get(Object key) {
            if (!(key instanceof String keyText)) {
                return null;
            }
            return resolveValue(keyText, rawValues, resolvedValues, new LinkedHashSet<>(stack));
        }
    }
}
