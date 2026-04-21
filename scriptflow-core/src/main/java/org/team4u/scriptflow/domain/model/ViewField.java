package org.team4u.scriptflow.domain.model;

import java.util.LinkedHashMap;
import java.util.Map;

public class ViewField {
    private String name;
    private String label;
    private String type;
    private Map<String, Object> props = new LinkedHashMap<>();

    public String getName() {
        return name;
    }

    public ViewField setName(String name) {
        this.name = name;
        return this;
    }

    public String getLabel() {
        return label;
    }

    public ViewField setLabel(String label) {
        this.label = label;
        return this;
    }

    public String getType() {
        return type;
    }

    public ViewField setType(String type) {
        this.type = type;
        return this;
    }

    public Map<String, Object> getProps() {
        return props;
    }

    public ViewField setProps(Map<String, Object> props) {
        this.props = props == null ? new LinkedHashMap<>() : props;
        return this;
    }
}
