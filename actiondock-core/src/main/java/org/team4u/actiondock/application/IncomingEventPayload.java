package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.SchemaValueCopier;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 入站事件负载，封装 Webhook 请求的原始数据。
 * <p>
 * 包含 HTTP 请求的 headers、query 参数、请求体（解析后和原始形式）以及 Content-Type 信息。
 * 所有集合类型的 getter/setter 均通过 {@link SchemaValueCopier} 进行防御性拷贝，确保不可变性。
 *
 * @author jay.wu
 */
public class IncomingEventPayload {
    private Map<String, Object> headers = new LinkedHashMap<>();
    private Map<String, Object> query = new LinkedHashMap<>();
    private Object body = new LinkedHashMap<String, Object>();
    private String rawBody;
    private String contentType;

    public Map<String, Object> getHeaders() {
        return SchemaValueCopier.copyMap(headers);
    }

    public IncomingEventPayload setHeaders(Map<String, Object> headers) {
        this.headers = SchemaValueCopier.copyMap(headers);
        return this;
    }

    public Map<String, Object> getQuery() {
        return SchemaValueCopier.copyMap(query);
    }

    public IncomingEventPayload setQuery(Map<String, Object> query) {
        this.query = SchemaValueCopier.copyMap(query);
        return this;
    }

    public Object getBody() {
        return SchemaValueCopier.copyObject(body);
    }

    public IncomingEventPayload setBody(Object body) {
        this.body = SchemaValueCopier.copyObject(body);
        return this;
    }

    public String getRawBody() {
        return rawBody;
    }

    public IncomingEventPayload setRawBody(String rawBody) {
        this.rawBody = rawBody;
        return this;
    }

    public String getContentType() {
        return contentType;
    }

    public IncomingEventPayload setContentType(String contentType) {
        this.contentType = contentType;
        return this;
    }
}
