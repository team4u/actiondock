package org.team4u.actiondock.web.schedule;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.application.ScheduleApplicationService;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.schedule.ScriptScheduleDispatcher;
import org.team4u.actiondock.web.common.ApiResponse;
import org.team4u.actiondock.web.script.ScriptScheduleUpsertRequest;
import org.team4u.actiondock.web.script.ScriptScheduleView;
import org.team4u.actiondock.web.script.ScriptScheduleViewMapper;

import java.util.List;

/**
 * 调度控制器共享支持类，封装两个调度 Controller 的公共依赖和操作逻辑。
 *
 * @author jay.wu
 */
@Component
public class ScheduleControllerSupport {
    private final ScheduleApplicationService scheduleApplicationService;
    private final ScriptScheduleDispatcher scriptScheduleDispatcher;
    private final ScriptScheduleViewMapper scriptScheduleViewMapper;

    ScheduleControllerSupport(ScheduleApplicationService scheduleApplicationService,
                              ScriptScheduleDispatcher scriptScheduleDispatcher,
                              ScriptScheduleViewMapper scriptScheduleViewMapper) {
        this.scheduleApplicationService = scheduleApplicationService;
        this.scriptScheduleDispatcher = scriptScheduleDispatcher;
        this.scriptScheduleViewMapper = scriptScheduleViewMapper;
    }

    public List<ScriptScheduleView> listAll() {
        return scheduleApplicationService.listAll().stream()
                .map(scriptScheduleViewMapper::toView)
                .toList();
    }

    public List<ScriptScheduleView> listByScript(String scriptId) {
        return scheduleApplicationService.list(scriptId).stream()
                .map(scriptScheduleViewMapper::toView)
                .toList();
    }

    public ScriptScheduleView detail(String scheduleId) {
        return scriptScheduleViewMapper.toView(scheduleApplicationService.getById(scheduleId));
    }

    public ApiResponse<ScriptScheduleView> createSchedule(String scriptId, ScriptScheduleUpsertRequest request) {
        ScriptSchedule schedule = scheduleApplicationService.save(scriptId, toDomain(request, null));
        scriptScheduleDispatcher.refreshScript(schedule.getScriptId());
        return ApiResponse.success(scriptScheduleViewMapper.toView(schedule), "已创建");
    }

    public ApiResponse<ScriptScheduleView> updateSchedule(String scriptId, String scheduleId,
                                                   ScriptScheduleUpsertRequest request) {
        ScriptSchedule schedule = scheduleApplicationService.save(scriptId, toDomain(request, scheduleId));
        scriptScheduleDispatcher.refreshScript(scriptId);
        return ApiResponse.success(scriptScheduleViewMapper.toView(schedule), "已更新");
    }

    public ApiResponse<ScriptScheduleView> enableSchedule(String scheduleId) {
        ScriptSchedule schedule = scheduleApplicationService.enableByScheduleId(scheduleId);
        scriptScheduleDispatcher.refreshScript(schedule.getScriptId());
        return ApiResponse.success(scriptScheduleViewMapper.toView(schedule), "已启用");
    }

    public ApiResponse<ScriptScheduleView> enableSchedule(String scriptId, String scheduleId) {
        ScriptSchedule schedule = scheduleApplicationService.enable(scriptId, scheduleId);
        scriptScheduleDispatcher.refreshScript(scriptId);
        return ApiResponse.success(scriptScheduleViewMapper.toView(schedule), "已启用");
    }

    public ApiResponse<ScriptScheduleView> disableSchedule(String scheduleId) {
        ScriptSchedule schedule = scheduleApplicationService.disableByScheduleId(scheduleId);
        scriptScheduleDispatcher.refreshScript(schedule.getScriptId());
        return ApiResponse.success(scriptScheduleViewMapper.toView(schedule), "已停用");
    }

    public ApiResponse<ScriptScheduleView> disableSchedule(String scriptId, String scheduleId) {
        ScriptSchedule schedule = scheduleApplicationService.disable(scriptId, scheduleId);
        scriptScheduleDispatcher.refreshScript(scriptId);
        return ApiResponse.success(scriptScheduleViewMapper.toView(schedule), "已停用");
    }

    public ApiResponse<Void> deleteSchedule(String scheduleId) {
        ScriptSchedule schedule = scheduleApplicationService.getById(scheduleId);
        scheduleApplicationService.deleteByScheduleId(scheduleId);
        scriptScheduleDispatcher.refreshScript(schedule.getScriptId());
        return ApiResponse.success(null, "已删除");
    }

    public ApiResponse<Void> deleteSchedule(String scriptId, String scheduleId) {
        scheduleApplicationService.delete(scriptId, scheduleId);
        scriptScheduleDispatcher.refreshScript(scriptId);
        return ApiResponse.success(null, "已删除");
    }

    static ScriptSchedule toDomain(ScriptScheduleUpsertRequest request, String scheduleId) {
        return new ScriptSchedule()
                .setId(scheduleId)
                .setName(request.getName())
                .setCronExpression(request.getCronExpression())
                .setInput(request.getInput())
                .setEnabled(request.isEnabled());
    }
}
