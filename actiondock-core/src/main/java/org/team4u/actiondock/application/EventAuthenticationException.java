package org.team4u.actiondock.application;

/**
 * 事件认证异常。
 * <p>
 * 当事件来源的认证校验失败时（如 API Key 无效或缺失）抛出此异常，
 * 对应 HTTP 401 状态码。
 *
 * @author jay.wu
 */
public class EventAuthenticationException extends RuntimeException {
    public EventAuthenticationException(String message) {
        super(message);
    }
}
