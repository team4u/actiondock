package org.team4u.scriptflow.domain.model;

import java.util.LinkedHashMap;
import java.util.Map;

public class PageActionDefinition {
    private String id;
    private String name;
    private String type;
    private String method = "POST";
    private Map<String, Object> options = new LinkedHashMap<>();

    public String getId() {
        return id;
    }

    public PageActionDefinition setId(String id) {
        this.id = id;
        return this;
    }

    public String getName() {
        return name;
    }

    public PageActionDefinition setName(String name) {
        this.name = name;
        return this;
    }

    public String getType() {
        return type;
    }

    public PageActionDefinition setType(String type) {
        this.type = type;
        return this;
    }

    public String getMethod() {
        return method;
    }

    public PageActionDefinition setMethod(String method) {
        this.method = method;
        return this;
    }

    public Map<String, Object> getOptions() {
        return options;
    }

    public PageActionDefinition setOptions(Map<String, Object> options) {
        this.options = options == null ? new LinkedHashMap<>() : options;
        return this;
    }
}
