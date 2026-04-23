package org.team4u.scriptflow.web;

import org.springframework.web.bind.annotation.*;
import org.team4u.scriptflow.application.ExecutionApplicationService;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.ScriptDefinition;

import java.util.List;

/**
 * 执行记录 REST 控制器，提供脚本执行的提交、查询和删除端点。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/executions")
public class ExecutionController {
    private final ExecutionApplicationService executionApplicationService;
    private final ScriptApplicationService scriptApplicationService;
    private final ExecutionResponseMapper executionResponseMapper;

    public ExecutionController(ExecutionApplicationService executionApplicationService,
                               ScriptApplicationService scriptApplicationService) {
        this.executionApplicationService = executionApplicationService;
        this.scriptApplicationService = scriptApplicationService;
        this.executionResponseMapper = new ExecutionResponseMapper();
    }

    @PostMapping
    public ApiResponse<ExecutionResponse> execute(@RequestBody ExecuteRequest request) {
        ExecutionRecord record = executionApplicationService.execute(
                request.getScriptId(),
                request.getInput(),
                request.getMode()
        );
        ScriptDefinition scriptDefinition = scriptApplicationService.get(request.getScriptId());
        return ApiResponse.success(
                executionResponseMapper.toResponse(record, scriptDefinition, request.getResponseView()),
                "已受理"
        );
    }

    @GetMapping("/{id}")
    public ApiResponse<ExecutionRecord> detail(@PathVariable String id) {
        return ApiResponse.success(executionApplicationService.get(id));
    }

    @GetMapping
    public ApiResponse<List<ExecutionRecord>> list(@RequestParam(required = false) String scriptId) {
        return ApiResponse.success(executionApplicationService.list(scriptId));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable String id) {
        executionApplicationService.delete(id);
        return ApiResponse.success(null, "已删除");
    }

    @DeleteMapping
    public ApiResponse<Void> clear(@RequestParam(required = false) String scriptId) {
        executionApplicationService.clear(scriptId);
        return ApiResponse.success(null, "已清空");
    }
}
