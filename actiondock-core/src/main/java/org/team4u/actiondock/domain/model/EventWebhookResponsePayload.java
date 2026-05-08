package org.team4u.actiondock.domain.model;

import java.util.LinkedHashMap;
import java.util.Map;

public class EventWebhookResponsePayload {
    private int status = 200;
    private Map<String, String> headers = new LinkedHashMap<>();
    private Map<String, Object> body = new LinkedHashMap<>();

    public int getStatus() {
        return status;
    }

    public EventWebhookResponsePayload setStatus(int status) {
        this.status = status <= 0 ? 200 : status;
        return this;
    }

    public Map<String, String> getHeaders() {
        return new LinkedHashMap<>(headers);
    }

    public EventWebhookResponsePayload setHeaders(Map<String, String> headers) {
        this.headers = headers == null ? new LinkedHashMap<>() : new LinkedHashMap<>(headers);
        return this;
    }

    public Map<String, Object> getBody() {
        return SchemaValueCopier.copyMap(body);
    }

    public EventWebhookResponsePayload setBody(Map<String, Object> body) {
        this.body = SchemaValueCopier.copyMap(body);
        return this;
    }
}
