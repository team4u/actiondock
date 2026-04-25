package org.team4u.actiondock.web;

/**
 * 全局配置值写入请求。
 *
 * @author jay.wu
 */
public class ConfigValueRequest {
    private String key;
    private String value = "";
    private String description;

    public String getKey() {
        return key;
    }

    public void setKey(String key) {
        this.key = key;
    }

    public String getValue() {
        return value;
    }

    public void setValue(String value) {
        this.value = value == null ? "" : value;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }
}
