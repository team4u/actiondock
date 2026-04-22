package org.team4u.scriptflow.domain.model;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

public class PublishedScriptSnapshot {
    private String name;
    private ScriptType type = ScriptType.GROOVY;
    private String source;
    private Map<String, Object> inputSchema = new LinkedHashMap<>();
    private Map<String, Object> outputSchema = new LinkedHashMap<>();

    public PublishedScriptSnapshot() {
    }

    public PublishedScriptSnapshot(PublishedScriptSnapshot other) {
        if (other == null) {
            return;
        }
        this.name = other.getName();
        this.type = other.getType();
        this.source = other.getSource();
        this.inputSchema = SchemaValueCopier.copyMap(other.getInputSchema());
        this.outputSchema = SchemaValueCopier.copyMap(other.getOutputSchema());
    }

    public String getName() {
        return name;
    }

    public PublishedScriptSnapshot setName(String name) {
        this.name = name;
        return this;
    }

    public ScriptType getType() {
        return type;
    }

    public PublishedScriptSnapshot setType(ScriptType type) {
        this.type = type == null ? ScriptType.GROOVY : type;
        return this;
    }

    public String getSource() {
        return source;
    }

    public PublishedScriptSnapshot setSource(String source) {
        this.source = source;
        return this;
    }

    public Map<String, Object> getInputSchema() {
        return inputSchema;
    }

    public PublishedScriptSnapshot setInputSchema(Map<String, Object> inputSchema) {
        this.inputSchema = SchemaValueCopier.copyMap(inputSchema);
        return this;
    }

    public Map<String, Object> getOutputSchema() {
        return outputSchema;
    }

    public PublishedScriptSnapshot setOutputSchema(Map<String, Object> outputSchema) {
        this.outputSchema = SchemaValueCopier.copyMap(outputSchema);
        return this;
    }

    public PublishedScriptSnapshot copy() {
        return new PublishedScriptSnapshot(this);
    }

    @Override
    public boolean equals(Object object) {
        if (this == object) {
            return true;
        }
        if (!(object instanceof PublishedScriptSnapshot other)) {
            return false;
        }
        return Objects.equals(name, other.name)
                && type == other.type
                && Objects.equals(source, other.source)
                && Objects.equals(inputSchema, other.inputSchema)
                && Objects.equals(outputSchema, other.outputSchema);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, type, source, inputSchema, outputSchema);
    }
}
