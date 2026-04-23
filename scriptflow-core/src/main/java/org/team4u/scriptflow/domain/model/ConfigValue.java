package org.team4u.scriptflow.domain.model;

import java.time.LocalDateTime;

/**
 * 平台级配置值定义。
 * <p>
 * 使用 key/value 形式保存可复用的全局字符串配置，可被脚本、插件和调度输入引用。
 *
 * @author jay.wu
 */
public class ConfigValue {
    private String key;
    private String value = "";
    private String description;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getKey() {
        return key;
    }

    public ConfigValue setKey(String key) {
        this.key = key;
        return this;
    }

    public String getValue() {
        return value;
    }

    public ConfigValue setValue(String value) {
        this.value = value == null ? "" : value;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public ConfigValue setDescription(String description) {
        this.description = description;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public ConfigValue setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public ConfigValue setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
