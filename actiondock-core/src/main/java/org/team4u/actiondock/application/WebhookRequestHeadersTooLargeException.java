package org.team4u.actiondock.application;

/**
 * Webhook 请求头大小超限异常。
 * <p>
 * 当入站 Webhook 请求的 headers 总大小超过系统允许的限制时抛出此异常。
 *
 * @author jay.wu
 */
public class WebhookRequestHeadersTooLargeException extends RuntimeException {
    public WebhookRequestHeadersTooLargeException(String message) {
        super(message);
    }
}
