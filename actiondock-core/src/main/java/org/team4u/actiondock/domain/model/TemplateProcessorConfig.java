package org.team4u.actiondock.domain.model;

import java.util.LinkedHashMap;
import java.util.Map;

public class TemplateProcessorConfig {

    private static final String DEFAULT_ENGINE = "MUSTACHE";

    private String engine = DEFAULT_ENGINE;
    private Map<String, Object> template = new LinkedHashMap<>();

    public String getEngine() {
        return engine;
    }

    public TemplateProcessorConfig setEngine(String engine) {
        this.engine = engine == null || engine.isBlank() ? DEFAULT_ENGINE : engine;
        return this;
    }

    public Map<String, Object> getTemplate() {
        return SchemaValueCopier.copyMap(template);
    }

    public TemplateProcessorConfig setTemplate(Map<String, Object> template) {
        this.template = SchemaValueCopier.copyMap(template);
        return this;
    }
}
