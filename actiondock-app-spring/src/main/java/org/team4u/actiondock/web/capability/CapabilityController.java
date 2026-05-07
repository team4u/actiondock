package org.team4u.actiondock.web.capability;

import org.springframework.web.bind.annotation.*;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.web.common.ApiResponse;
import org.team4u.actiondock.web.execution.ExecutionResponse;
import org.team4u.actiondock.web.execution.ExecutionResponseMapper;
import org.team4u.actiondock.web.script.ScriptPatchService;

import java.util.List;
import java.util.Map;

/**
 * 统一能力入口。当前以脚本能力为主，后续可扩展到插件动作、Skill 和 AI agent。
 */
@RestController
@RequestMapping("/api/capabilities")
public class CapabilityController {

    private final ScriptApplicationService scriptApplicationService;
    private final ScriptPatchService scriptPatchService;
    private final ExecutionApplicationService executionApplicationService;
    private final ExecutionResponseMapper executionResponseMapper;
    private final CapabilityViewMapper capabilityViewMapper;

    public CapabilityController(ScriptApplicationService scriptApplicationService,
                                ScriptPatchService scriptPatchService,
                                ExecutionApplicationService executionApplicationService,
                                ExecutionResponseMapper executionResponseMapper,
                                CapabilityViewMapper capabilityViewMapper) {
        this.scriptApplicationService = scriptApplicationService;
        this.scriptPatchService = scriptPatchService;
        this.executionApplicationService = executionApplicationService;
        this.executionResponseMapper = executionResponseMapper;
        this.capabilityViewMapper = capabilityViewMapper;
    }

    @GetMapping
    public ApiResponse<List<CapabilityView>> list(@RequestParam(defaultValue = "false") boolean includeUiSchema,
                                                  @RequestParam(defaultValue = "false") boolean includeManaged) {
        return ApiResponse.success(
                scriptApplicationService.list(includeManaged).stream()
                        .map(item -> capabilityViewMapper.toView(item, includeUiSchema))
                        .toList()
        );
    }

    @GetMapping("/{id}")
    public ApiResponse<CapabilityView> detail(@PathVariable String id,
                                              @RequestParam(defaultValue = "false") boolean includeUiSchema) {
        return ApiResponse.success(capabilityViewMapper.toView(scriptApplicationService.get(id), includeUiSchema));
    }

    @PostMapping
    public ApiResponse<CapabilityView> create(@RequestParam(defaultValue = "false") boolean includeUiSchema,
                                              @RequestBody CapabilityUpsertRequest request) {
        ScriptDefinition saved = scriptApplicationService.save(request.toScriptDefinition());
        return ApiResponse.success(capabilityViewMapper.toView(saved, includeUiSchema));
    }

    @PutMapping("/{id}")
    public ApiResponse<CapabilityView> update(@PathVariable String id,
                                              @RequestParam(defaultValue = "false") boolean includeUiSchema,
                                              @RequestBody CapabilityUpsertRequest request) {
        ScriptDefinition definition = request.toScriptDefinition();
        definition.setId(id);
        ScriptDefinition saved = scriptApplicationService.save(definition);
        return ApiResponse.success(capabilityViewMapper.toView(saved, includeUiSchema));
    }

    @PatchMapping("/{id}")
    public ApiResponse<CapabilityView> patch(@PathVariable String id,
                                             @RequestParam(defaultValue = "false") boolean includeUiSchema,
                                             @RequestBody(required = false) CapabilityPatchRequest request) {
        Map<String, Object> draftBindingPatch = request == null ? null : request.getDraftBinding();
        ScriptDefinition updated = scriptPatchService.patch(id, draftBindingPatch);
        return ApiResponse.success(capabilityViewMapper.toView(updated, includeUiSchema));
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
    public ApiResponse<CapabilityView> publish(@PathVariable String id,
                                               @RequestParam(defaultValue = "false") boolean includeUiSchema) {
        return ApiResponse.success(
                capabilityViewMapper.toView(scriptApplicationService.publish(id), includeUiSchema),
                "发布成功"
        );
    }

    @PostMapping("/{id}/discard-draft")
    public ApiResponse<CapabilityView> discardDraft(@PathVariable String id,
                                                    @RequestParam(defaultValue = "false") boolean includeUiSchema) {
        return ApiResponse.success(
                capabilityViewMapper.toView(scriptApplicationService.discardDraft(id), includeUiSchema),
                "草稿已丢弃"
        );
    }

    @PostMapping("/{id}/execute")
    public ApiResponse<ExecutionResponse> execute(@PathVariable String id,
                                                  @RequestBody(required = false) CapabilityExecuteRequest request) {
        CapabilityExecuteRequest safeRequest = request == null ? new CapabilityExecuteRequest() : request;
        ExecutionRecord record = safeRequest.isDraft()
                ? executionApplicationService.execute(id, safeRequest.getInput(), safeRequest.getMode())
                : executionApplicationService.executePublished(id, safeRequest.getInput(), safeRequest.getMode());
        ScriptDefinition definition = safeRequest.isDraft()
                ? scriptApplicationService.get(id)
                : scriptApplicationService.getPublished(id);
        return ApiResponse.success(
                executionResponseMapper.toResponse(record, definition, safeRequest.getResponseView()),
                "已受理"
        );
    }
}
