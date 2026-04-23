package org.team4u.scriptflow.web;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.scriptflow.application.ScheduleApplicationService;
import org.team4u.scriptflow.domain.model.ScriptSchedule;
import org.team4u.scriptflow.domain.port.ExecutionRepository;
import org.team4u.scriptflow.schedule.ScriptScheduleDispatcher;

import java.util.List;

/**
 * 脚本级调度 REST 控制器，管理指定脚本下的定时调度配置。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/scripts/{scriptId}/schedules")
public class ScriptScheduleController {
    private final ScheduleApplicationService scheduleApplicationService;
    private final ScriptScheduleDispatcher scriptScheduleDispatcher;
    private final ScriptScheduleViewMapper scriptScheduleViewMapper;

    public ScriptScheduleController(ScheduleApplicationService scheduleApplicationService,
                                    ScriptScheduleDispatcher scriptScheduleDispatcher,
                                    ExecutionRepository executionRepository) {
        this.scheduleApplicationService = scheduleApplicationService;
        this.scriptScheduleDispatcher = scriptScheduleDispatcher;
        this.scriptScheduleViewMapper = new ScriptScheduleViewMapper(executionRepository);
    }

    @GetMapping
    public ApiResponse<List<ScriptScheduleView>> list(@PathVariable String scriptId) {
        return ApiResponse.success(scheduleApplicationService.list(scriptId).stream()
                .map(scriptScheduleViewMapper::toView)
                .toList());
    }

    @PostMapping
    public ApiResponse<ScriptScheduleView> create(@PathVariable String scriptId,
                                                  @RequestBody ScriptScheduleUpsertRequest request) {
        ScriptSchedule schedule = scheduleApplicationService.save(scriptId, toDomain(request, null));
        scriptScheduleDispatcher.refreshScript(scriptId);
        return ApiResponse.success(scriptScheduleViewMapper.toView(schedule), "定时任务已创建");
    }

    @PutMapping("/{scheduleId}")
    public ApiResponse<ScriptScheduleView> update(@PathVariable String scriptId,
                                                  @PathVariable String scheduleId,
                                                  @RequestBody ScriptScheduleUpsertRequest request) {
        ScriptSchedule schedule = scheduleApplicationService.save(scriptId, toDomain(request, scheduleId));
        scriptScheduleDispatcher.refreshScript(scriptId);
        return ApiResponse.success(scriptScheduleViewMapper.toView(schedule), "定时任务已更新");
    }

    @PostMapping("/{scheduleId}/enable")
    public ApiResponse<ScriptScheduleView> enable(@PathVariable String scriptId, @PathVariable String scheduleId) {
        ScriptSchedule schedule = scheduleApplicationService.enable(scriptId, scheduleId);
        scriptScheduleDispatcher.refreshScript(scriptId);
        return ApiResponse.success(scriptScheduleViewMapper.toView(schedule), "定时任务已启用");
    }

    @PostMapping("/{scheduleId}/disable")
    public ApiResponse<ScriptScheduleView> disable(@PathVariable String scriptId, @PathVariable String scheduleId) {
        ScriptSchedule schedule = scheduleApplicationService.disable(scriptId, scheduleId);
        scriptScheduleDispatcher.refreshScript(scriptId);
        return ApiResponse.success(scriptScheduleViewMapper.toView(schedule), "定时任务已停用");
    }

    @DeleteMapping("/{scheduleId}")
    public ApiResponse<Void> delete(@PathVariable String scriptId, @PathVariable String scheduleId) {
        scheduleApplicationService.delete(scriptId, scheduleId);
        scriptScheduleDispatcher.refreshScript(scriptId);
        return ApiResponse.success(null, "定时任务已删除");
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
