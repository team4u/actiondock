package org.team4u.actiondock.web;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.domain.model.ScriptSchedule;

import java.util.List;

/**
 * 全局调度 REST 控制器，提供定时调度的管理和启停端点。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/schedules")
public class ScheduleController {
    private final ScheduleControllerSupport support;

    public ScheduleController(ScheduleControllerSupport support) {
        this.support = support;
    }

    @GetMapping
    public ApiResponse<List<ScriptScheduleView>> list() {
        return ApiResponse.success(support.listAll());
    }

    @GetMapping("/{scheduleId}")
    public ApiResponse<ScriptScheduleView> detail(@PathVariable String scheduleId) {
        return ApiResponse.success(support.detail(scheduleId));
    }

    @PostMapping
    public ApiResponse<ScriptScheduleView> create(@RequestBody ScriptScheduleUpsertRequest request) {
        return support.createSchedule(resolveScriptId(request), request);
    }

    @PutMapping("/{scheduleId}")
    public ApiResponse<ScriptScheduleView> update(@PathVariable String scheduleId,
                                                  @RequestBody ScriptScheduleUpsertRequest request) {
        ScriptSchedule existing = support.scheduleApplicationService.getById(scheduleId);
        String scriptId = resolveScriptId(request);
        if (!existing.getScriptId().equals(scriptId)) {
            throw new IllegalArgumentException("不支持修改所属脚本");
        }
        return support.updateSchedule(scriptId, scheduleId, request);
    }

    @PostMapping("/{scheduleId}/enable")
    public ApiResponse<ScriptScheduleView> enable(@PathVariable String scheduleId) {
        ScriptSchedule existing = support.scheduleApplicationService.getById(scheduleId);
        return support.enableSchedule(existing.getScriptId(), scheduleId);
    }

    @PostMapping("/{scheduleId}/disable")
    public ApiResponse<ScriptScheduleView> disable(@PathVariable String scheduleId) {
        ScriptSchedule existing = support.scheduleApplicationService.getById(scheduleId);
        return support.disableSchedule(existing.getScriptId(), scheduleId);
    }

    @DeleteMapping("/{scheduleId}")
    public ApiResponse<Void> delete(@PathVariable String scheduleId) {
        ScriptSchedule existing = support.scheduleApplicationService.getById(scheduleId);
        return support.deleteSchedule(existing.getScriptId(), scheduleId);
    }

    private static String resolveScriptId(ScriptScheduleUpsertRequest request) {
        if (request.getScriptId() == null || request.getScriptId().isBlank()) {
            throw new IllegalArgumentException("scriptId 不能为空");
        }
        return request.getScriptId().trim();
    }
}
