package org.team4u.actiondock.domain.model;

import java.util.LinkedHashMap;
import java.util.Map;

public class ProcessorDefinition {
    private ProcessorMode mode;
    private JsonPathProcessorConfig jsonPath;
    private TemplateProcessorConfig template;
    private ScriptRefProcessorConfig scriptRef;
    private Map<String, Object> outputSchema = new LinkedHashMap<>();
    private String description;

    public ProcessorMode getMode() {
        return mode;
    }

    public ProcessorDefinition setMode(ProcessorMode mode) {
        this.mode = mode;
        return this;
    }

    public JsonPathProcessorConfig getJsonPath() {
        return jsonPath;
    }

    public ProcessorDefinition setJsonPath(JsonPathProcessorConfig jsonPath) {
        this.jsonPath = jsonPath;
        return this;
    }

    public TemplateProcessorConfig getTemplate() {
        return template;
    }

    public ProcessorDefinition setTemplate(TemplateProcessorConfig template) {
        this.template = template;
        return this;
    }

    public ScriptRefProcessorConfig getScriptRef() {
        return scriptRef;
    }

    public ProcessorDefinition setScriptRef(ScriptRefProcessorConfig scriptRef) {
        this.scriptRef = scriptRef;
        return this;
    }

    public Map<String, Object> getOutputSchema() {
        return SchemaValueCopier.copyMap(outputSchema);
    }

    public ProcessorDefinition setOutputSchema(Map<String, Object> outputSchema) {
        this.outputSchema = SchemaValueCopier.copyMap(outputSchema);
        return this;
    }

    public String getDescription() {
        return description;
    }

    public ProcessorDefinition setDescription(String description) {
        this.description = description;
        return this;
    }

    public boolean isEmpty() {
        boolean emptyMode = mode == null;
        boolean emptyJsonPath = jsonPath == null || jsonPath.getFields().isEmpty();
        boolean emptyTemplate = template == null || template.getTemplate().isEmpty();
        boolean emptyScriptRef = scriptRef == null || scriptRef.getScriptId() == null || scriptRef.getScriptId().isBlank();
        boolean emptyOutputSchema = outputSchema == null || outputSchema.isEmpty();
        boolean emptyDescription = description == null || description.isBlank();
        return emptyMode && emptyJsonPath && emptyTemplate && emptyScriptRef && emptyOutputSchema && emptyDescription;
    }
}
