package org.team4u.actiondock.web.execution;

import org.springframework.web.bind.annotation.*;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.web.common.ApiResponse;

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
                               ScriptApplicationService scriptApplicationService,
                               ExecutionResponseMapper executionResponseMapper) {
        this.executionApplicationService = executionApplicationService;
        this.scriptApplicationService = scriptApplicationService;
        this.executionResponseMapper = executionResponseMapper;
    }

    /**
     * 提交脚本执行。
     * <p>
     * 根据请求中的脚本 ID 查找脚本定义，提交执行并返回执行结果。
     *
     * @param request 执行请求，包含脚本 ID、输入参数和执行模式
     * @return API 响应，包含执行结果
     */
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

    /**
     * 查询执行记录详情。
     *
     * @param id 执行记录 ID
     * @return API 响应，包含执行记录
     */
    @GetMapping("/{id}")
    public ApiResponse<ExecutionRecordResponse> detail(@PathVariable String id) {
        ExecutionRecord record = executionApplicationService.get(id);
        ScriptDefinition scriptDefinition = resolveScriptDefinition(record.getScriptId());
        return ApiResponse.success(executionResponseMapper.toRecordResponse(record, scriptDefinition));
    }

    /**
     * 取消仍在等待或运行中的执行记录。
     *
     * @param id 执行记录 ID
     * @return API 响应，包含取消后的执行记录
     */
    @PostMapping("/{id}/cancel")
    public ApiResponse<ExecutionRecordResponse> cancel(@PathVariable String id) {
        ExecutionRecord record = executionApplicationService.cancel(id);
        ScriptDefinition scriptDefinition = resolveScriptDefinition(record.getScriptId());
        return ApiResponse.success(executionResponseMapper.toRecordResponse(record, scriptDefinition), "已取消");
    }

    /**
     * 查询执行记录列表。
     * <p>
     * 支持 scriptId 或 scheduleId 筛选，两者必须提供其一。
     *
     * @param scriptId    脚本 ID（可选）
     * @param scheduleId  调度 ID（可选）
     * @return API 响应，包含执行记录列表
     */
    @GetMapping
    public ApiResponse<List<ExecutionRecordResponse>> list(
            @RequestParam(required = false) String scriptId,
            @RequestParam(required = false) String scheduleId) {
        if (scheduleId != null && !scheduleId.isBlank()) {
            return ApiResponse.success(executionApplicationService.listByScheduleId(scheduleId).stream()
                    .map(this::toRecordResponse)
                    .toList());
        }
        if (scriptId == null || scriptId.isBlank()) {
            throw new IllegalArgumentException("scriptId 或 scheduleId 必须提供其一");
        }
        ScriptDefinition scriptDefinition = resolveScriptDefinition(scriptId);
        return ApiResponse.success(executionApplicationService.list(scriptId).stream()
                .map(record -> executionResponseMapper.toRecordResponse(record, scriptDefinition))
                .toList());
    }

    /**
     * 删除指定执行记录。
     *
     * @param id 执行记录 ID
     * @return API 响应，无数据
     */
    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable String id) {
        executionApplicationService.delete(id);
        return ApiResponse.success(null, "已删除");
    }

    /**
     * 清空执行记录。
     * <p>
     * 若指定 scriptId 则仅清空该脚本的执行记录，否则清空全部。
     *
     * @param scriptId 可选的脚本 ID，用于按脚本筛选
     * @return API 响应，无数据
     */
    @DeleteMapping
    public ApiResponse<Void> clear(@RequestParam(required = false) String scriptId) {
        executionApplicationService.clear(scriptId);
        return ApiResponse.success(null, "已清空");
    }

    private ExecutionRecordResponse toRecordResponse(ExecutionRecord record) {
        ScriptDefinition scriptDefinition = resolveScriptDefinition(record.getScriptId());
        return executionResponseMapper.toRecordResponse(record, scriptDefinition);
    }

    private ScriptDefinition resolveScriptDefinition(String scriptId) {
        try {
            return scriptApplicationService.get(scriptId);
        } catch (IllegalArgumentException ex) {
            return new ScriptDefinition().setId(scriptId);
        }
    }
}
