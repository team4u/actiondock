package org.team4u.scriptflow.web;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record SchemaResponse(
        List<SchemaFieldView> input,
        List<SchemaFieldView> output
) {
}
