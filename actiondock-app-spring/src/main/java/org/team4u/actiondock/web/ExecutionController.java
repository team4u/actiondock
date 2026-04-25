package org.team4u.actiondock.web;

import org.springframework.web.bind.annotation.*;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ScriptDefinition;

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
    public ApiResponse<ExecutionRecord> detail(@PathVariable String id) {
        return ApiResponse.success(executionApplicationService.get(id));
    }

    /**
     * 查询指定脚本的执行记录列表。
     *
     * @param scriptId 脚本 ID
     * @return API 响应，包含执行记录列表
     */
    @GetMapping
    public ApiResponse<List<ExecutionRecord>> list(@RequestParam String scriptId) {
        return ApiResponse.success(executionApplicationService.list(scriptId));
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
}
