package org.team4u.actiondock.web;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.application.ScheduleApplicationService;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.schedule.ScriptScheduleDispatcher;

import java.util.List;

/**
 * 全局调度 REST 控制器，提供定时调度的管理和启停端点。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/schedules")
public class ScheduleController {
    private final ScheduleApplicationService scheduleApplicationService;
    private final ScriptScheduleDispatcher scriptScheduleDispatcher;
    private final ScriptScheduleViewMapper scriptScheduleViewMapper;

    public ScheduleController(ScheduleApplicationService scheduleApplicationService,
                              ScriptScheduleDispatcher scriptScheduleDispatcher,
                              ExecutionRepository executionRepository) {
        this.scheduleApplicationService = scheduleApplicationService;
        this.scriptScheduleDispatcher = scriptScheduleDispatcher;
        this.scriptScheduleViewMapper = new ScriptScheduleViewMapper(executionRepository);
    }

    /**
     * 查询所有定时调度列表。
     *
     * @return API 响应，包含调度视图列表
     */
    @GetMapping
    public ApiResponse<List<ScriptScheduleView>> list() {
        return ApiResponse.success(scheduleApplicationService.listAll().stream()
                .map(scriptScheduleViewMapper::toView)
                .toList());
    }

    /**
     * 查询指定调度详情。
     *
     * @param scheduleId 调度 ID
     * @return API 响应，包含调度视图
     */
    @GetMapping("/{scheduleId}")
    public ApiResponse<ScriptScheduleView> detail(@PathVariable String scheduleId) {
        return ApiResponse.success(scriptScheduleViewMapper.toView(scheduleApplicationService.getById(scheduleId)));
    }

    /**
     * 创建定时调度。
     * <p>
     * 创建后自动刷新对应脚本的调度任务。
     *
     * @param request 调度创建请求
     * @return API 响应，包含创建后的调度视图
     */
    @PostMapping
    public ApiResponse<ScriptScheduleView> create(@RequestBody ScriptScheduleUpsertRequest request) {
        ScriptSchedule schedule = scheduleApplicationService.save(resolveScriptId(request), toDomain(request, null));
        scriptScheduleDispatcher.refreshScript(schedule.getScriptId());
        return ApiResponse.success(scriptScheduleViewMapper.toView(schedule), "已创建");
    }

    /**
     * 更新定时调度配置。
     * <p>
     * 不支持修改调度所属的脚本，更新后自动刷新调度任务。
     *
     * @param scheduleId 调度 ID
     * @param request 调度更新请求
     * @return API 响应，包含更新后的调度视图
     */
    @PutMapping("/{scheduleId}")
    public ApiResponse<ScriptScheduleView> update(@PathVariable String scheduleId,
                                                  @RequestBody ScriptScheduleUpsertRequest request) {
        ScriptSchedule existing = scheduleApplicationService.getById(scheduleId);
        String scriptId = resolveScriptId(request);
        if (!existing.getScriptId().equals(scriptId)) {
            throw new IllegalArgumentException("不支持修改所属脚本");
        }
        ScriptSchedule schedule = scheduleApplicationService.save(scriptId, toDomain(request, scheduleId));
        scriptScheduleDispatcher.refreshScript(scriptId);
        return ApiResponse.success(scriptScheduleViewMapper.toView(schedule), "已更新");
    }

    /**
     * 启用指定调度。
     *
     * @param scheduleId 调度 ID
     * @return API 响应，包含启用后的调度视图
     */
    @PostMapping("/{scheduleId}/enable")
    public ApiResponse<ScriptScheduleView> enable(@PathVariable String scheduleId) {
        ScriptSchedule existing = scheduleApplicationService.getById(scheduleId);
        ScriptSchedule schedule = scheduleApplicationService.enable(existing.getScriptId(), scheduleId);
        scriptScheduleDispatcher.refreshScript(existing.getScriptId());
        return ApiResponse.success(scriptScheduleViewMapper.toView(schedule), "已启用");
    }

    /**
     * 停用指定调度。
     *
     * @param scheduleId 调度 ID
     * @return API 响应，包含停用后的调度视图
     */
    @PostMapping("/{scheduleId}/disable")
    public ApiResponse<ScriptScheduleView> disable(@PathVariable String scheduleId) {
        ScriptSchedule existing = scheduleApplicationService.getById(scheduleId);
        ScriptSchedule schedule = scheduleApplicationService.disable(existing.getScriptId(), scheduleId);
        scriptScheduleDispatcher.refreshScript(existing.getScriptId());
        return ApiResponse.success(scriptScheduleViewMapper.toView(schedule), "已停用");
    }

    /**
     * 删除指定调度。
     *
     * @param scheduleId 调度 ID
     * @return API 响应，无数据
     */
    @DeleteMapping("/{scheduleId}")
    public ApiResponse<Void> delete(@PathVariable String scheduleId) {
        ScriptSchedule existing = scheduleApplicationService.getById(scheduleId);
        scheduleApplicationService.delete(existing.getScriptId(), scheduleId);
        scriptScheduleDispatcher.refreshScript(existing.getScriptId());
        return ApiResponse.success(null, "已删除");
    }

    private String resolveScriptId(ScriptScheduleUpsertRequest request) {
        if (request.getScriptId() == null || request.getScriptId().isBlank()) {
            throw new IllegalArgumentException("scriptId 不能为空");
        }
        return request.getScriptId().trim();
    }

    private ScriptSchedule toDomain(ScriptScheduleUpsertRequest request, String scheduleId) {
        return new ScriptSchedule()
                .setId(scheduleId)
                .setName(request.getName())
                .setCronExpression(request.getCronExpression())
                .setInput(request.getInput())
                .setEnabled(request.isEnabled());
    }
}
