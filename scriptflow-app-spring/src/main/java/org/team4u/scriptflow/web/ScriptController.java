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

    /**
     * 查询所有脚本定义列表。
     *
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @return API 响应，包含脚本定义列表
     */
    @GetMapping
    public ApiResponse<List<ScriptDefinition>> list(@RequestParam(defaultValue = "false") boolean includeUiSchema) {
        return ApiResponse.success(scriptApplicationService.list().stream()
                .map(definition -> toResponse(definition, includeUiSchema))
                .toList());
    }

    /**
     * 新建或更新脚本定义。
     *
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @param definition 脚本定义内容
     * @return API 响应，包含保存后的脚本定义
     */
    @PostMapping
    public ApiResponse<ScriptDefinition> save(
            @RequestParam(defaultValue = "false") boolean includeUiSchema,
            @RequestBody ScriptDefinition definition
    ) {
        return ApiResponse.success(toResponse(scriptApplicationService.save(definition), includeUiSchema));
    }

    /**
     * 查询脚本定义详情（草稿版本）。
     *
     * @param id 脚本 ID
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @return API 响应，包含脚本定义
     */
    @GetMapping("/{id}")
    public ApiResponse<ScriptDefinition> detail(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema
    ) {
        return ApiResponse.success(toResponse(scriptApplicationService.get(id), includeUiSchema));
    }

    /**
     * 查询已发布的脚本定义详情。
     *
     * @param id 脚本 ID
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @return API 响应，包含已发布的脚本快照
     */
    @GetMapping("/{id}/published")
    public ApiResponse<ScriptDefinition> publishedDetail(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema
    ) {
        return ApiResponse.success(toResponse(scriptApplicationService.getPublished(id), includeUiSchema));
    }

    /**
     * 更新已有脚本定义。
     *
     * @param id 脚本 ID
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @param definition 更新后的脚本定义内容
     * @return API 响应，包含更新后的脚本定义
     */
    @PutMapping("/{id}")
    public ApiResponse<ScriptDefinition> update(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema,
            @RequestBody ScriptDefinition definition
    ) {
        definition.setId(id);
        return ApiResponse.success(toResponse(scriptApplicationService.save(definition), includeUiSchema));
    }

    /**
     * 删除脚本定义及其关联的定时调度。
     *
     * @param id 脚本 ID
     * @return API 响应，无数据
     */
    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable String id) {
        scriptApplicationService.delete(id);
        scriptScheduleDispatcher.refreshScript(id);
        return ApiResponse.success(null);
    }

    /**
     * 校验脚本草稿的合法性。
     *
     * @param id 脚本 ID
     * @return API 响应，校验通过时无数据
     */
    @PostMapping("/{id}/validate")
    public ApiResponse<Void> validate(@PathVariable String id) {
        scriptApplicationService.validate(id);
        return ApiResponse.success(null, "校验通过");
    }

    /**
     * 发布脚本草稿，将当前草稿内容保存为已发布快照。
     *
     * @param id 脚本 ID
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @return API 响应，包含发布后的脚本定义
     */
    @PostMapping("/{id}/publish")
    public ApiResponse<ScriptDefinition> publish(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema
    ) {
        return ApiResponse.success(toResponse(scriptApplicationService.publish(id), includeUiSchema), "发布成功");
    }

    /**
     * 丢弃脚本草稿，恢复为已发布快照的内容。
     *
     * @param id 脚本 ID
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @return API 响应，包含恢复后的脚本定义
     */
    @PostMapping("/{id}/discard-draft")
    public ApiResponse<ScriptDefinition> discardDraft(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema
    ) {
        return ApiResponse.success(toResponse(scriptApplicationService.discardDraft(id), includeUiSchema), "草稿已丢弃");
    }

    /**
     * 执行已发布的脚本。
     * <p>
     * 根据脚本 ID 查找已发布的版本并执行，返回执行结果。
     *
     * @param id 脚本 ID
     * @param request 执行请求，包含输入参数和执行模式
     * @return API 响应，包含执行结果
     */
    @PostMapping("/{id}/published/execute")
    public ApiResponse<ExecutionResponse> executePublished(@PathVariable String id, @RequestBody ExecuteRequest request) {
        ExecutionRecord record = executionApplicationService.executePublished(id, request.getInput(), request.getMode());
        ScriptDefinition scriptDefinition = scriptApplicationService.getPublished(id);
        return ApiResponse.success(
                executionResponseMapper.toResponse(record, scriptDefinition, request.getResponseView()),
                "已受理"
        );
    }

    /**
     * Fork 指定脚本到当前命名空间。
     *
     * @param id 原始脚本 ID
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @param request Fork 请求，包含目标 ID 和名称
     * @return API 响应，包含 Fork 后的脚本定义
     */
    @PostMapping("/{id}/fork")
    public ApiResponse<ScriptDefinition> fork(@PathVariable String id,
                                              @RequestParam(defaultValue = "false") boolean includeUiSchema,
                                              @RequestBody RepositoryForkRequest request) {
        return ApiResponse.success(
                toResponse(scriptApplicationService.createFork(id, request.getId(), request.getName()), includeUiSchema),
                "Fork 创建成功"
        );
    }

    private ScriptDefinition toResponse(ScriptDefinition definition, boolean includeUiSchema) {
        return includeUiSchema ? definition : SchemaViewSanitizer.sanitize(definition);
    }
}
