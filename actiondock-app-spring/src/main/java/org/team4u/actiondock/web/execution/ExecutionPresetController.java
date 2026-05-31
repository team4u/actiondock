package org.team4u.actiondock.web.execution;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.application.ExecutionPresetApplicationService;
import org.team4u.actiondock.domain.model.ExecutionPreset;
import org.team4u.actiondock.web.common.ApiResponse;
import org.team4u.actiondock.web.common.IntentFilter;

import java.util.List;

/**
 * 执行参数预设 REST 控制器，管理指定脚本下的参数预设。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/scripts/{scriptId}/presets")
public class ExecutionPresetController {

    private final ExecutionPresetApplicationService executionPresetApplicationService;
    private final ExecutionPresetViewMapper executionPresetViewMapper;

    public ExecutionPresetController(ExecutionPresetApplicationService executionPresetApplicationService,
                                     ExecutionPresetViewMapper executionPresetViewMapper) {
        this.executionPresetApplicationService = executionPresetApplicationService;
        this.executionPresetViewMapper = executionPresetViewMapper;
    }

    /**
     * 查询指定脚本下的所有参数预设。
     *
     * @param scriptId 脚本 ID
     * @return API 响应，包含预设视图列表
     */
    @GetMapping
    public ApiResponse<List<ExecutionPresetView>> list(@PathVariable String scriptId,
                                                       @RequestParam(required = false) String intent) {
        List<ExecutionPresetView> items = executionPresetApplicationService.list(scriptId).stream()
                .map(executionPresetViewMapper::toView)
                .toList();
        return ApiResponse.success(IntentFilter.filter(items, intent,
                ExecutionPresetView::id,
                ExecutionPresetView::name,
                ExecutionPresetView::scriptId,
                ExecutionPresetView::repositoryId,
                ExecutionPresetView::repositoryPackageId,
                ExecutionPresetView::repositoryVersion
        ));
    }

    /**
     * 在指定脚本下创建参数预设。
     *
     * @param scriptId 脚本 ID
     * @param request 预设创建请求
     * @return API 响应，包含创建后的预设视图
     */
    @PostMapping
    public ApiResponse<ExecutionPresetView> create(@PathVariable String scriptId,
                                                   @RequestBody ExecutionPresetUpsertRequest request) {
        ExecutionPreset preset = executionPresetApplicationService.save(scriptId, toDomain(request, null));
        return ApiResponse.success(executionPresetViewMapper.toView(preset), "预设已创建");
    }

    /**
     * 更新指定脚本下的参数预设。
     *
     * @param scriptId 脚本 ID
     * @param presetId 预设 ID
     * @param request 预设更新请求
     * @return API 响应，包含更新后的预设视图
     */
    @PutMapping("/{presetId}")
    public ApiResponse<ExecutionPresetView> update(@PathVariable String scriptId,
                                                   @PathVariable String presetId,
                                                   @RequestBody ExecutionPresetUpsertRequest request) {
        ExecutionPreset preset = executionPresetApplicationService.save(scriptId, toDomain(request, presetId));
        return ApiResponse.success(executionPresetViewMapper.toView(preset), "预设已更新");
    }

    /**
     * 删除指定脚本下的参数预设。
     *
     * @param scriptId 脚本 ID
     * @param presetId 预设 ID
     * @return API 响应，无数据
     */
    @DeleteMapping("/{presetId}")
    public ApiResponse<Void> delete(@PathVariable String scriptId, @PathVariable String presetId) {
        executionPresetApplicationService.delete(scriptId, presetId);
        return ApiResponse.success(null, "预设已删除");
    }

    private static ExecutionPreset toDomain(ExecutionPresetUpsertRequest request, String presetId) {
        return new ExecutionPreset()
                .setId(presetId)
                .setName(request.getName())
                .setInput(request.getInput());
    }
}
