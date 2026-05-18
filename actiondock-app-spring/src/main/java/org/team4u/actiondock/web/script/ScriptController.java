package org.team4u.actiondock.web.script;

import org.springframework.web.bind.annotation.*;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.repository.RepositoryCatalogTypes;
import org.team4u.actiondock.repository.RepositoryScriptService;
import org.team4u.actiondock.schedule.ScriptScheduleDispatcher;
import org.team4u.actiondock.web.common.ApiResponse;
import org.team4u.actiondock.web.execution.ExecuteRequest;
import org.team4u.actiondock.web.execution.ExecutionResponse;
import org.team4u.actiondock.web.execution.ExecutionResponseMapper;
import org.team4u.actiondock.web.repository.RepositoryForkRequest;

import java.util.List;
import java.util.Map;

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
    private final RepositoryScriptService repositoryToolService;
    private final ScriptPatchService scriptPatchService;

    public ScriptController(ScriptApplicationService scriptApplicationService,
                            ExecutionApplicationService executionApplicationService,
                            ScriptScheduleDispatcher scriptScheduleDispatcher,
                            RepositoryScriptService repositoryToolService,
                            ExecutionResponseMapper executionResponseMapper,
                            ScriptPatchService scriptPatchService) {
        this.scriptApplicationService = scriptApplicationService;
        this.executionApplicationService = executionApplicationService;
        this.scriptScheduleDispatcher = scriptScheduleDispatcher;
        this.repositoryToolService = repositoryToolService;
        this.executionResponseMapper = executionResponseMapper;
        this.scriptPatchService = scriptPatchService;
    }

    /**
     * 查询所有脚本定义列表。
     *
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @return API 响应，包含脚本定义列表
     */
    @GetMapping
    public ApiResponse<List<ScriptDocumentView>> list(@RequestParam(defaultValue = "false") boolean includeUiSchema,
                                                      @RequestParam(defaultValue = "false") boolean includeManaged) {
        return ApiResponse.success(scriptApplicationService.list(includeManaged).stream()
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
    public ApiResponse<ScriptDocumentView> save(
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
    public ApiResponse<ScriptDocumentView> detail(
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
    public ApiResponse<ScriptPublishedRevisionView> publishedDetail(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema
    ) {
        return ApiResponse.success(ScriptViewMapper.toPublishedView(scriptApplicationService.getPublished(id), includeUiSchema));
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
    public ApiResponse<ScriptDocumentView> update(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema,
            @RequestBody ScriptDefinition definition
    ) {
        definition.setId(id);
        return ApiResponse.success(toResponse(scriptApplicationService.save(definition), includeUiSchema));
    }

    /**
     * 对脚本定义应用 JSON Merge Patch (RFC 7396) 部分更新。
     *
     * @param id 脚本 ID
     * @param includeUiSchema 是否在响应中包含 UI Schema 信息
     * @param patch 补丁内容
     * @return API 响应，包含更新后的脚本定义
     */
    @PatchMapping("/{id}")
    public ApiResponse<ScriptDocumentView> patch(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean includeUiSchema,
            @RequestBody(required = false) Map<String, Object> patch
    ) {
        return ApiResponse.success(toResponse(scriptPatchService.patch(id, patch), includeUiSchema));
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
    public ApiResponse<ScriptDocumentView> publish(
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
    public ApiResponse<ScriptDocumentView> discardDraft(
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
     * 执行脚本。默认执行已发布版本；请求体中 draft=true 时执行草稿。
     *
     * @param id 脚本 ID
     * @param request 执行请求，包含输入参数、执行模式和草稿标记
     * @return API 响应，包含执行结果
     */
    @PostMapping("/{id}/execute")
    public ApiResponse<ExecutionResponse> execute(@PathVariable String id,
                                                  @RequestBody(required = false) ExecuteRequest request) {
        ExecuteRequest safeRequest = request == null ? new ExecuteRequest() : request;
        ExecutionRecord record = safeRequest.isDraft()
                ? executionApplicationService.execute(id, safeRequest.getInput(), safeRequest.getMode())
                : executionApplicationService.executePublished(id, safeRequest.getInput(), safeRequest.getMode());
        ScriptDefinition scriptDefinition = safeRequest.isDraft()
                ? scriptApplicationService.get(id)
                : scriptApplicationService.getPublished(id);
        return ApiResponse.success(
                executionResponseMapper.toResponse(record, scriptDefinition, safeRequest.getResponseView()),
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
    public ApiResponse<ScriptDocumentView> fork(@PathVariable String id,
                                                @RequestParam(defaultValue = "false") boolean includeUiSchema,
                                                @RequestBody RepositoryForkRequest request) {
        return ApiResponse.success(
                toResponse(scriptApplicationService.createFork(id, request.getId(), request.getName()), includeUiSchema),
                "Fork 创建成功"
        );
    }

    @GetMapping("/{id}/upstream")
    public ApiResponse<RepositoryCatalogTypes.UpstreamStatus> upstreamStatus(@PathVariable String id) {
        return ApiResponse.success(repositoryToolService.getUpstreamStatus(id));
    }

    @PostMapping("/{id}/upstream/pull")
    public ApiResponse<ScriptDocumentView> upstreamPull(@PathVariable String id,
                                                        @RequestParam(defaultValue = "false") boolean force,
                                                        @RequestParam(defaultValue = "false") boolean includeUiSchema) {
        return ApiResponse.success(
                toResponse(repositoryToolService.pullUpstreamScript(id, force), includeUiSchema),
                "脚本工作副本已拉取上游更新"
        );
    }

    @DeleteMapping("/{id}/upstream")
    public ApiResponse<Void> detachUpstream(@PathVariable String id) {
        repositoryToolService.detachUpstream(id);
        return ApiResponse.success(null, "已断开上游跟踪");
    }

    private ScriptDocumentView toResponse(ScriptDefinition definition, boolean includeUiSchema) {
        return ScriptViewMapper.toView(definition, includeUiSchema);
    }
}
