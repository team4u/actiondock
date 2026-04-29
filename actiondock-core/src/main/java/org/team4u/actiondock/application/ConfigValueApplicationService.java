package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.port.ConfigValueRepository;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
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
    private static final ConfigValueApplicationService DISABLED = new ConfigValueApplicationService();

    private final ConfigValueRepository configValueRepository;
    private final ConfigPlaceholderResolver placeholderResolver;
    private final boolean enabled;

    private ConfigValueApplicationService() {
        this.configValueRepository = null;
        this.placeholderResolver = null;
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
        this.placeholderResolver = new ConfigPlaceholderResolver(configValueRepository);
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
    public ConfigValue update(String key, ConfigValue configValue, boolean preserveValue) {
        ensureEnabled();
        String normalizedKey = normalizeKey(key);
        ConfigValue existing = requireExisting(normalizedKey);
        if (existing.isManaged() && !existing.isOverridden()) {
            throw new IllegalArgumentException("托管配置值需先复制为本地覆盖值后再修改");
        }
        ConfigValue normalized = normalizeForUpdate(normalizedKey, configValue, preserveValue, existing);
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

    public ConfigValue copyAsLocalOverride(String key) {
        ensureEnabled();
        ConfigValue existing = requireExisting(normalizeKey(key));
        if (!existing.isManaged()) {
            throw new IllegalArgumentException("仅托管配置值支持复制为本地覆盖值");
        }
        if (existing.isOverridden()) {
            return copy(existing);
        }
        existing.setOverridden(true)
                .setUpdatedAt(LocalDateTime.now());
        return copy(configValueRepository.save(existing));
    }

    public ConfigValue restoreManagedValue(String key, ConfigValue restoredValue) {
        ensureEnabled();
        String normalizedKey = normalizeKey(key);
        ConfigValue existing = requireExisting(normalizedKey);
        if (!existing.isManaged()) {
            throw new IllegalArgumentException("仅托管配置值支持恢复仓库默认值");
        }
        ConfigValue normalized = normalizeForRestore(normalizedKey, restoredValue, existing);
        normalized.setCreatedAt(existing.getCreatedAt())
                .setUpdatedAt(LocalDateTime.now());
        return copy(configValueRepository.save(normalized));
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
        return placeholderResolver.snapshot();
    }

    public Map<String, Object> resolveMap(Map<String, Object> source) {
        if (!enabled) {
            return source == null ? new LinkedHashMap<>() : new LinkedHashMap<>(source);
        }
        return placeholderResolver.resolveMap(source, snapshot());
    }

    public Object resolveObject(Object value) {
        if (!enabled) {
            return value;
        }
        return placeholderResolver.resolveObject(value, snapshot());
    }

    public String resolveText(String value) {
        if (!enabled) {
            return value == null ? "" : value;
        }
        return placeholderResolver.resolveText(value, snapshot());
    }

    private ConfigValue normalizeForCreate(ConfigValue configValue) {
        if (configValue == null) {
            throw new IllegalArgumentException("配置值不能为空");
        }
        return new ConfigValue()
                .setKey(normalizeKey(configValue.getKey()))
                .setValue(configValue.getValue())
                .setDescription(normalizeDescription(configValue.getDescription()))
                .setSecret(configValue.isSecret())
                .setRepositoryId(configValue.getRepositoryId())
                .setRepositoryToolId(configValue.getRepositoryToolId())
                .setRepositoryVersion(configValue.getRepositoryVersion())
                .setPublishMode(configValue.getPublishMode())
                .setManaged(configValue.isManaged())
                .setOverridden(configValue.isOverridden());
    }

    private ConfigValue normalizeForUpdate(String key,
                                           ConfigValue configValue,
                                           boolean preserveValue,
                                           ConfigValue existing) {
        if (configValue == null) {
            throw new IllegalArgumentException("配置值不能为空");
        }
        if (configValue.getKey() != null && !configValue.getKey().isBlank() && !key.equals(normalizeKey(configValue.getKey()))) {
            throw new IllegalArgumentException("不支持修改配置值 key");
        }
        return new ConfigValue()
                .setKey(key)
                .setValue(preserveValue ? existing.getValue() : configValue.getValue())
                .setDescription(normalizeDescription(configValue.getDescription()))
                .setSecret(configValue.isSecret())
                .setRepositoryId(configValue.getRepositoryId())
                .setRepositoryToolId(configValue.getRepositoryToolId())
                .setRepositoryVersion(configValue.getRepositoryVersion())
                .setPublishMode(configValue.getPublishMode())
                .setManaged(configValue.isManaged())
                .setOverridden(configValue.isOverridden());
    }

    private ConfigValue normalizeForRestore(String key, ConfigValue restoredValue, ConfigValue existing) {
        if (restoredValue == null) {
            throw new IllegalArgumentException("恢复默认值缺少来源模板");
        }
        if (restoredValue.getKey() != null && !restoredValue.getKey().isBlank() && !key.equals(normalizeKey(restoredValue.getKey()))) {
            throw new IllegalArgumentException("恢复默认值的 key 不匹配");
        }
        return new ConfigValue()
                .setKey(key)
                .setValue(restoredValue.getValue())
                .setDescription(normalizeDescription(restoredValue.getDescription()))
                .setSecret(restoredValue.isSecret())
                .setRepositoryId(restoredValue.getRepositoryId() == null ? existing.getRepositoryId() : restoredValue.getRepositoryId())
                .setRepositoryToolId(restoredValue.getRepositoryToolId() == null ? existing.getRepositoryToolId() : restoredValue.getRepositoryToolId())
                .setRepositoryVersion(restoredValue.getRepositoryVersion() == null ? existing.getRepositoryVersion() : restoredValue.getRepositoryVersion())
                .setPublishMode(restoredValue.getPublishMode() == null ? existing.getPublishMode() : restoredValue.getPublishMode())
                .setManaged(true)
                .setOverridden(false);
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
                .setSecret(source.isSecret())
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
}
