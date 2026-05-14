package org.team4u.actiondock.domain.model;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class WebhookResponsePayload {
    private int status = 200;
    private Map<String, List<String>> headers = new LinkedHashMap<>();
    private Object body;

    public int getStatus() {
        return status;
    }

    public WebhookResponsePayload setStatus(int status) {
        this.status = status <= 0 ? 200 : status;
        return this;
    }

    public Map<String, List<String>> getHeaders() {
        return copy(headers);
    }

    public WebhookResponsePayload setHeaders(Map<String, List<String>> headers) {
        this.headers = copy(headers);
        return this;
    }

    public Object getBody() {
        return SchemaValueCopier.copyObject(body);
    }

    public WebhookResponsePayload setBody(Object body) {
        this.body = SchemaValueCopier.copyObject(body);
        return this;
    }

    private static Map<String, List<String>> copy(Map<String, List<String>> source) {
        Map<String, List<String>> target = new LinkedHashMap<>();
        if (source == null) {
            return target;
        }
        source.forEach((name, values) -> target.put(name, values == null ? List.of() : List.copyOf(new ArrayList<>(values))));
        return target;
    }
}
