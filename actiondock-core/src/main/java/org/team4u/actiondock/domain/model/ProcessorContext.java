package org.team4u.actiondock.domain.model;

import java.util.LinkedHashMap;
import java.util.Map;

public class ProcessorContext {
    private Map<String, Object> event = new LinkedHashMap<>();
    private Map<String, Object> headers = new LinkedHashMap<>();
    private Map<String, Object> query = new LinkedHashMap<>();
    private Object body = new LinkedHashMap<String, Object>();
    private String rawBody;
    private Map<String, Object> source = new LinkedHashMap<>();
    private Map<String, Object> trigger = new LinkedHashMap<>();
    private Map<String, Object> variables = new LinkedHashMap<>();

    public Map<String, Object> getEvent() {
        return SchemaValueCopier.copyMap(event);
    }

    public ProcessorContext setEvent(Map<String, Object> event) {
        this.event = SchemaValueCopier.copyMap(event);
        return this;
    }

    public Map<String, Object> getHeaders() {
        return SchemaValueCopier.copyMap(headers);
    }

    public ProcessorContext setHeaders(Map<String, Object> headers) {
        this.headers = SchemaValueCopier.copyMap(headers);
        return this;
    }

    public Map<String, Object> getQuery() {
        return SchemaValueCopier.copyMap(query);
    }

    public ProcessorContext setQuery(Map<String, Object> query) {
        this.query = SchemaValueCopier.copyMap(query);
        return this;
    }

    public Object getBody() {
        return SchemaValueCopier.copyObject(body);
    }

    public ProcessorContext setBody(Object body) {
        this.body = SchemaValueCopier.copyObject(body);
        return this;
    }

    public String getRawBody() {
        return rawBody;
    }

    public ProcessorContext setRawBody(String rawBody) {
        this.rawBody = rawBody;
        return this;
    }

    public Map<String, Object> getSource() {
        return SchemaValueCopier.copyMap(source);
    }

    public ProcessorContext setSource(Map<String, Object> source) {
        this.source = SchemaValueCopier.copyMap(source);
        return this;
    }

    public Map<String, Object> getTrigger() {
        return SchemaValueCopier.copyMap(trigger);
    }

    public ProcessorContext setTrigger(Map<String, Object> trigger) {
        this.trigger = SchemaValueCopier.copyMap(trigger);
        return this;
    }

    public Map<String, Object> getVariables() {
        return SchemaValueCopier.copyMap(variables);
    }

    public ProcessorContext setVariables(Map<String, Object> variables) {
        this.variables = SchemaValueCopier.copyMap(variables);
        return this;
    }

    public Map<String, Object> toMap() {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("event", getEvent());
        value.put("headers", getHeaders());
        value.put("query", getQuery());
        value.put("body", getBody());
        value.put("rawBody", getRawBody());
        value.put("source", getSource());
        value.put("trigger", getTrigger());
        value.put("variables", getVariables());
        return value;
    }
}
