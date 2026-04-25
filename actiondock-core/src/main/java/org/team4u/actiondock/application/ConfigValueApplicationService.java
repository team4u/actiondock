package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.port.ConfigValueRepository;

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

    /**
     * 使用配置值仓库创建启用的配置值服务实例。
     *
     * @param configValueRepository 配置值持久化仓库
     * @throws NullPointerException 如果 configValueRepository 为 null
     */
    public ConfigValueApplicationService(ConfigValueRepository configValueRepository) {
        this.configValueRepository = Objects.requireNonNull(configValueRepository);
        this.enabled = true;
    }

    /**
     * 获取禁用状态的配置值服务实例。
     * <p>
     * 禁用状态下所有配置操作将抛出 {@link IllegalStateException}，
     * 查询类方法返回空结果。
     *
     * @return 禁用状态的单例实例
     */
    public static ConfigValueApplicationService disabled() {
        return DISABLED;
    }

    /**
     * 查询所有配置值，按 key 字母序排列。
     *
     * @return 配置值列表（禁用状态下返回空列表）
     */
    public List<ConfigValue> list() {
        if (!enabled) {
            return List.of();
        }
        return configValueRepository.findAll().stream()
                .sorted((left, right) -> left.getKey().compareTo(right.getKey()))
                .map(this::copy)
                .toList();
    }

    /**
     * 根据 key 查询配置值。
     *
     * @param key 配置键名
     * @return 配置值
     * @throws IllegalArgumentException 如果 key 格式不合法或配置值不存在
     * @throws IllegalStateException    如果服务未启用
     */
    public ConfigValue get(String key) {
        ensureEnabled();
        return copy(requireExisting(normalizeKey(key)));
    }

    /**
     * 创建配置值。
     * <p>
     * 自动标准化 key 格式并设置创建和更新时间。不允许创建重复 key。
     *
     * @param configValue 配置值信息（需包含 key 和 value）
     * @return 创建后的配置值
     * @throws IllegalArgumentException 如果参数为空、key 格式不合法或 key 已存在
     * @throws IllegalStateException    如果服务未启用
     */
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

    /**
     * 更新配置值。
     * <p>
     * 根据 key 定位已有配置值，更新其 value 和 description。
     * 不支持修改 key 本身。
     *
     * @param key         要更新的配置键名
     * @param configValue 新的配置值信息
     * @return 更新后的配置值
     * @throws IllegalArgumentException 如果 key 不存在、参数为空或试图修改 key
     * @throws IllegalStateException    如果服务未启用
     */
    public ConfigValue update(String key, ConfigValue configValue) {
        ensureEnabled();
        String normalizedKey = normalizeKey(key);
        ConfigValue existing = requireExisting(normalizedKey);
        ConfigValue normalized = normalizeForUpdate(normalizedKey, configValue);
        normalized.setCreatedAt(existing.getCreatedAt())
                .setUpdatedAt(LocalDateTime.now())
                .setRepositoryId(existing.getRepositoryId())
                .setRepositoryToolId(existing.getRepositoryToolId())
                .setRepositoryVersion(existing.getRepositoryVersion())
                .setPublishMode(existing.getPublishMode())
                .setManaged(existing.isManaged())
                .setOverridden(existing.isManaged() || existing.isOverridden());
        return copy(configValueRepository.save(normalized));
    }

    /**
     * 删除配置值。
     *
     * @param key 要删除的配置键名
     * @throws IllegalArgumentException 如果 key 格式不合法或配置值不存在
     * @throws IllegalStateException    如果服务未启用
     */
    public void delete(String key) {
        ensureEnabled();
        String normalizedKey = normalizeKey(key);
        requireExisting(normalizedKey);
        configValueRepository.deleteByKey(normalizedKey);
    }

    /**
     * 生成配置值的解析快照。
     * <p>
     * 加载所有原始配置值，递归解析其中的 {@code ${config.xxx}} 占位符引用，
     * 并检测循环引用。返回不可变的已解析键值映射。
     *
     * @return 已解析的配置值快照（禁用状态下返回空 Map）
     * @throws IllegalArgumentException 如果存在循环引用或引用了不存在的 key
     */
    public Map<String, String> snapshot() {
        if (!enabled) {
            return Map.of();
        }
        Map<String, String> rawValues = loadRawValues();
        Map<String, String> resolved = new LinkedHashMap<>();
        rawValues.keySet().forEach(key -> resolveValue(key, rawValues, resolved, new LinkedHashSet<>()));
        return Collections.unmodifiableMap(new LinkedHashMap<>(resolved));
    }

    /**
     * 解析 Map 结构中的所有配置占位符。
     * <p>
     * 递归遍历 Map 中的所有字符串值，将 {@code ${config.xxx}} 占位符替换为实际配置值。
     *
     * @param source 原始输入 Map，可以为 null
     * @return 解析后的 Map
     */
    public Map<String, Object> resolveMap(Map<String, Object> source) {
        if (source == null) {
            return new LinkedHashMap<>();
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> resolved = (Map<String, Object>) resolveObject(source, snapshot());
        return resolved;
    }

    /**
     * 解析对象中的所有配置占位符。
     * <p>
     * 支持 Map、List 和 String 类型的递归解析，其他类型直接返回。
     *
     * @param value 待解析的对象
     * @return 解析后的对象
     */
    public Object resolveObject(Object value) {
        return resolveObject(value, snapshot());
    }

    /**
     * 解析字符串中的配置占位符。
     * <p>
     * 将字符串中所有 {@code ${config.xxx}} 格式的占位符替换为对应的配置值。
     *
     * @param value 待解析的字符串
     * @return 解析后的字符串
     * @throws IllegalArgumentException 如果引用了不存在的配置 key
     */
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
                .setDescription(normalizeDescription(configValue.getDescription()))
                .setRepositoryId(configValue.getRepositoryId())
                .setRepositoryToolId(configValue.getRepositoryToolId())
                .setRepositoryVersion(configValue.getRepositoryVersion())
                .setPublishMode(configValue.getPublishMode())
                .setManaged(configValue.isManaged())
                .setOverridden(configValue.isOverridden());
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
                .setDescription(normalizeDescription(configValue.getDescription()))
                .setRepositoryId(configValue.getRepositoryId())
                .setRepositoryToolId(configValue.getRepositoryToolId())
                .setRepositoryVersion(configValue.getRepositoryVersion())
                .setPublishMode(configValue.getPublishMode())
                .setManaged(configValue.isManaged())
                .setOverridden(configValue.isOverridden());
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
                .setRepositoryId(source.getRepositoryId())
                .setRepositoryToolId(source.getRepositoryToolId())
                .setRepositoryVersion(source.getRepositoryVersion())
                .setPublishMode(source.getPublishMode())
                .setManaged(source.isManaged())
                .setOverridden(source.isOverridden())
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
