package org.team4u.actiondock.application;

/**
 * Webhook 请求体大小超限异常。
 * <p>
 * 当入站 Webhook 请求的 body 大小超过系统允许的限制时抛出此异常。
 *
 * @author jay.wu
 */
public class WebhookRequestPayloadTooLargeException extends RuntimeException {
    public WebhookRequestPayloadTooLargeException(String message) {
        super(message);
    }
}
