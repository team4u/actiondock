package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.WebhookSampleRequest;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class WebhookRequest {
    private String method = "POST";
    private String path;
    private Map<String, List<String>> headers = new LinkedHashMap<>();
    private Map<String, List<String>> query = new LinkedHashMap<>();
    private String rawBody;
    private String contentType;

    public String getMethod() {
        return method;
    }

    public WebhookRequest setMethod(String method) {
        this.method = method == null || method.isBlank() ? "POST" : method.trim().toUpperCase(java.util.Locale.ROOT);
        return this;
    }

    public String getPath() {
        return path;
    }

    public WebhookRequest setPath(String path) {
        this.path = path;
        return this;
    }

    public Map<String, List<String>> getHeaders() {
        return copy(headers);
    }

    public WebhookRequest setHeaders(Map<String, List<String>> headers) {
        this.headers = copy(headers);
        return this;
    }

    public Map<String, List<String>> getQuery() {
        return copy(query);
    }

    public WebhookRequest setQuery(Map<String, List<String>> query) {
        this.query = copy(query);
        return this;
    }

    public String getRawBody() {
        return rawBody;
    }

    public WebhookRequest setRawBody(String rawBody) {
        this.rawBody = rawBody;
        return this;
    }

    public String getContentType() {
        return contentType;
    }

    public WebhookRequest setContentType(String contentType) {
        this.contentType = contentType;
        return this;
    }

    public Map<String, Object> toInputMap() {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("method", method);
        request.put("path", path);
        request.put("headers", copy(headers));
        request.put("query", copy(query));
        request.put("rawBody", rawBody);
        request.put("contentType", contentType);
        return request;
    }

    public static WebhookRequest fromSample(String path, WebhookSampleRequest sample) {
        WebhookSampleRequest value = sample == null ? new WebhookSampleRequest() : sample;
        return new WebhookRequest()
                .setMethod(value.getMethod())
                .setPath(path)
                .setHeaders(value.getHeaders())
                .setQuery(value.getQuery())
                .setRawBody(value.getRawBody())
                .setContentType(value.getContentType());
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
