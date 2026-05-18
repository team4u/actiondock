package org.team4u.actiondock.domain.model;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class WebhookSampleRequest {
    private String method = "POST";
    private Map<String, List<String>> headers = new LinkedHashMap<>();
    private Map<String, List<String>> query = new LinkedHashMap<>();
    private String rawBody;
    private String contentType;

    public String getMethod() {
        return method;
    }

    public WebhookSampleRequest setMethod(String method) {
        this.method = method == null || method.isBlank() ? "POST" : method.trim().toUpperCase(java.util.Locale.ROOT);
        return this;
    }

    public Map<String, List<String>> getHeaders() {
        return copy(headers);
    }

    public WebhookSampleRequest setHeaders(Map<String, List<String>> headers) {
        this.headers = copy(headers);
        return this;
    }

    public Map<String, List<String>> getQuery() {
        return copy(query);
    }

    public WebhookSampleRequest setQuery(Map<String, List<String>> query) {
        this.query = copy(query);
        return this;
    }

    public String getRawBody() {
        return rawBody;
    }

    public WebhookSampleRequest setRawBody(String rawBody) {
        this.rawBody = rawBody;
        return this;
    }

    public String getContentType() {
        return contentType;
    }

    public WebhookSampleRequest setContentType(String contentType) {
        this.contentType = contentType;
        return this;
    }

    public boolean isEmpty() {
        return (method == null || method.isBlank() || "POST".equalsIgnoreCase(method))
                && headers.isEmpty()
                && query.isEmpty()
                && (rawBody == null || rawBody.isBlank())
                && (contentType == null || contentType.isBlank());
    }

    private static Map<String, List<String>> copy(Map<String, List<String>> source) {
        Map<String, List<String>> target = new LinkedHashMap<>();
        if (source == null) {
            return target;
        }
        source.forEach((key, value) -> target.put(key, value == null ? List.of() : List.copyOf(new ArrayList<>(value))));
        return target;
    }
}
