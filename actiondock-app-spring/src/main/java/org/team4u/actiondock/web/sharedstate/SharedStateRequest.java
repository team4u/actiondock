package org.team4u.actiondock.web.sharedstate;

import java.time.LocalDateTime;

/**
 * 共享状态写入请求。
 *
 * @author jay.wu
 */
public class SharedStateRequest {
    private String namespace;
    private String key;
    private Object value;
    private boolean secret;
    private LocalDateTime expiresAt;

    public String getNamespace() {
        return namespace;
    }

    public void setNamespace(String namespace) {
        this.namespace = namespace;
    }

    public String getKey() {
        return key;
    }

    public void setKey(String key) {
        this.key = key;
    }

    public Object getValue() {
        return value;
    }

    public void setValue(Object value) {
        this.value = value;
    }

    public boolean isSecret() {
        return secret;
    }

    public void setSecret(boolean secret) {
        this.secret = secret;
    }

    public LocalDateTime getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(LocalDateTime expiresAt) {
        this.expiresAt = expiresAt;
    }
}
