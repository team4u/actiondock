package org.team4u.scriptflow.web;

import org.springframework.web.bind.annotation.*;
import org.team4u.scriptflow.application.ExecutionApplicationService;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.schedule.ScriptScheduleDispatcher;
import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.ScriptDefinition;

import java.util.List;

/**
 * 脚本管理 REST 控制器，提供脚本定义的 CRUD、发布和执行端点。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/scripts")
public class ScriptController {
    private final ScriptApplicationService scriptApplicationService;
    private final ExecutionApplicationService executionApplicationService;
    private final ScriptScheduleDispatcher scriptScheduleDispatcher;
    private final ExecutionResponseMapper executionResponseMapper;

    public ScriptController(ScriptApplicationService scriptApplicationService,
                            ExecutionApplicationService executionApplicationService,
                            ScriptScheduleDispatcher scriptScheduleDispatcher) {
        this.scriptApplicationService = scriptApplicationService;
        this.executionApplicationService = executionApplicationService;
        this.scriptScheduleDispatcher = scriptScheduleDispatcher;
        this.executionResponseMapper = new ExecutionResponseMapper();
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

    @GetMapping("/{id}/published")
    public ApiResponse<ScriptDefinition> publishedDetail(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema
    ) {
        return ApiResponse.success(toResponse(scriptApplicationService.getPublished(id), includeUiSchema));
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
        scriptScheduleDispatcher.refreshScript(id);
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

    @PostMapping("/{id}/discard-draft")
    public ApiResponse<ScriptDefinition> discardDraft(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema
    ) {
        return ApiResponse.success(toResponse(scriptApplicationService.discardDraft(id), includeUiSchema), "草稿已丢弃");
    }

    @PostMapping("/{id}/published/execute")
    public ApiResponse<ExecutionResponse> executePublished(@PathVariable String id, @RequestBody ExecuteRequest request) {
        ExecutionRecord record = executionApplicationService.executePublished(id, request.getInput(), request.getMode());
        ScriptDefinition scriptDefinition = scriptApplicationService.getPublished(id);
        return ApiResponse.success(
                executionResponseMapper.toResponse(record, scriptDefinition, request.getResponseView()),
                "已受理"
        );
    }

    private ScriptDefinition toResponse(ScriptDefinition definition, boolean includeUiSchema) {
        return includeUiSchema ? definition : SchemaViewSanitizer.sanitize(definition);
    }
}
