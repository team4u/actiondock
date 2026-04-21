package org.team4u.scriptflow.web;

import org.springframework.web.bind.annotation.*;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.domain.model.ScriptDefinition;

import java.util.List;

@RestController
@RequestMapping("/api/scripts")
public class ScriptController {
    private final ScriptApplicationService scriptApplicationService;

    public ScriptController(ScriptApplicationService scriptApplicationService) {
        this.scriptApplicationService = scriptApplicationService;
    }

    @GetMapping
    public ApiResponse<List<ScriptDefinition>> list(@RequestParam(defaultValue = "false") boolean includeUiSchema) {
        return ApiResponse.success(scriptApplicationService.list().stream()
                .map(definition -> toResponse(definition, includeUiSchema))
                .toList());
    }

    @PostMapping
    public ApiResponse<ScriptDefinition> save(
            @RequestParam(defaultValue = "false") boolean includeUiSchema,
            @RequestBody ScriptDefinition definition
    ) {
        return ApiResponse.success(toResponse(scriptApplicationService.save(definition), includeUiSchema));
    }

    @GetMapping("/{id}")
    public ApiResponse<ScriptDefinition> detail(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema
    ) {
        return ApiResponse.success(toResponse(scriptApplicationService.get(id), includeUiSchema));
    }

    @PutMapping("/{id}")
    public ApiResponse<ScriptDefinition> update(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema,
            @RequestBody ScriptDefinition definition
    ) {
        definition.setId(id);
        return ApiResponse.success(toResponse(scriptApplicationService.save(definition), includeUiSchema));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable String id) {
        scriptApplicationService.delete(id);
        return ApiResponse.success(null);
    }

    @PostMapping("/{id}/validate")
    public ApiResponse<Void> validate(@PathVariable String id) {
        scriptApplicationService.validate(id);
        return ApiResponse.success(null, "校验通过");
    }

    @PostMapping("/{id}/publish")
    public ApiResponse<ScriptDefinition> publish(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema
    ) {
        return ApiResponse.success(toResponse(scriptApplicationService.publish(id), includeUiSchema), "发布成功");
    }

    private ScriptDefinition toResponse(ScriptDefinition definition, boolean includeUiSchema) {
        return includeUiSchema ? definition : SchemaViewSanitizer.sanitize(definition);
    }
}
