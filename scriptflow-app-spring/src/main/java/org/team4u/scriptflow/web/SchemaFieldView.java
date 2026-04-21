package org.team4u.scriptflow.web;

import com.fasterxml.jackson.annotation.JsonInclude;
import org.team4u.scriptflow.application.ScriptSchemaSupport;

import java.util.List;

@JsonInclude(JsonInclude.Include.NON_EMPTY)
public record SchemaFieldView(
        String name,
        String label,
        String kind,
        Boolean required,
        String description,
        List<String> enumValues,
        Object defaultValue,
        List<Object> examples
) {
    public static SchemaFieldView from(ScriptSchemaSupport.SchemaField field) {
        return new SchemaFieldView(
                field.name(),
                field.label(),
                field.kind(),
                field.required() ? Boolean.TRUE : null,
                field.description(),
                field.enumValues(),
                field.defaultValue(),
                field.examples()
        );
    }
}
