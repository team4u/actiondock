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
    public ApiResponse<List<ScriptDefinition>> list() {
        return ApiResponse.success(scriptApplicationService.list());
    }

    @PostMapping
    public ApiResponse<ScriptDefinition> save(@RequestBody ScriptDefinition definition) {
        return ApiResponse.success(scriptApplicationService.save(definition));
    }

    @GetMapping("/{id}")
    public ApiResponse<ScriptDefinition> detail(@PathVariable String id) {
        return ApiResponse.success(scriptApplicationService.get(id));
    }

    @PutMapping("/{id}")
    public ApiResponse<ScriptDefinition> update(@PathVariable String id, @RequestBody ScriptDefinition definition) {
        definition.setId(id);
        return ApiResponse.success(scriptApplicationService.save(definition));
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
    public ApiResponse<ScriptDefinition> publish(@PathVariable String id) {
        return ApiResponse.success(scriptApplicationService.publish(id), "发布成功");
    }
}
