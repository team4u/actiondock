package org.team4u.actiondock.application;

public class WebhookRequestPayloadTooLargeException extends RuntimeException {
    public WebhookRequestPayloadTooLargeException(String message) {
        super(message);
    }
}
