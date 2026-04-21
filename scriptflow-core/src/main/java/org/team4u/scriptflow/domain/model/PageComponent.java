package org.team4u.scriptflow.domain.model;

import java.util.LinkedHashMap;
import java.util.Map;

public class PageComponent {
    private String id;
    private String region;
    private String type;
    private String name;
    private String label;
    private Map<String, Object> props = new LinkedHashMap<>();

    public String getId() {
        return id;
    }

    public PageComponent setId(String id) {
        this.id = id;
        return this;
    }

    public String getRegion() {
        return region;
    }

    public PageComponent setRegion(String region) {
        this.region = region;
        return this;
    }

    public String getType() {
        return type;
    }

    public PageComponent setType(String type) {
        this.type = type;
        return this;
    }

    public String getName() {
        return name;
    }

    public PageComponent setName(String name) {
        this.name = name;
        return this;
    }

    public String getLabel() {
        return label;
    }

    public PageComponent setLabel(String label) {
        this.label = label;
        return this;
    }

    public Map<String, Object> getProps() {
        return props;
    }

    public PageComponent setProps(Map<String, Object> props) {
        this.props = props == null ? new LinkedHashMap<>() : props;
        return this;
    }
}
