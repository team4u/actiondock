package org.team4u.scriptflow.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.application.ScriptSchemaSupport;
import org.team4u.scriptflow.domain.model.ScriptDefinition;

import java.util.Map;

@RestController
@RequestMapping("/api/schema")
public class SchemaController {
    private final ScriptApplicationService scriptApplicationService;
    private final ScriptSchemaSupport scriptSchemaSupport;

    public SchemaController(ScriptApplicationService scriptApplicationService) {
        this.scriptApplicationService = scriptApplicationService;
        this.scriptSchemaSupport = new ScriptSchemaSupport();
    }

    @GetMapping("/{id}")
    public ApiResponse<SchemaResponse> detail(@PathVariable String id) {
        return ApiResponse.success(toResponse(scriptApplicationService.get(id)));
    }

    private SchemaResponse toResponse(ScriptDefinition definition) {
        ScriptSchemaSupport.SchemaSummary inputSummary = scriptSchemaSupport.summarize(definition.getInputSchema());
        ScriptSchemaSupport.SchemaSummary outputSummary = scriptSchemaSupport.summarize(definition.getOutputSchema());
        return new SchemaResponse(
                hasSchema(definition.getInputSchema()) ? inputSummary.fields().stream().map(SchemaFieldView::from).toList() : null,
                hasSchema(definition.getOutputSchema()) ? outputSummary.fields().stream().map(SchemaFieldView::from).toList() : null
        );
    }

    private boolean hasSchema(Map<String, Object> schema) {
        return schema != null && !schema.isEmpty();
    }
}
