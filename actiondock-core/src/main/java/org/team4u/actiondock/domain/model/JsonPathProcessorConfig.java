package org.team4u.actiondock.domain.model;

import java.util.LinkedHashMap;
import java.util.Map;

public class JsonPathProcessorConfig {
    private Map<String, String> fields = new LinkedHashMap<>();

    public Map<String, String> getFields() {
        return Map.copyOf(fields);
    }

    public JsonPathProcessorConfig setFields(Map<String, String> fields) {
        this.fields = fields == null ? new LinkedHashMap<>() : new LinkedHashMap<>(fields);
        return this;
    }
}
