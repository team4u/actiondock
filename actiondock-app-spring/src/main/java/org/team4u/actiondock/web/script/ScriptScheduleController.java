package org.team4u.actiondock.web.script;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.web.common.ApiResponse;
import org.team4u.actiondock.web.schedule.ScheduleControllerSupport;

import java.util.List;

/**
 * 脚本维度调度 REST 控制器，提供指定脚本下的调度管理端点。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/scripts/{scriptId}/schedules")
public class ScriptScheduleController {
    private final ScheduleControllerSupport support;

    public ScriptScheduleController(ScheduleControllerSupport support) {
        this.support = support;
    }

    @GetMapping
    public ApiResponse<List<ScriptScheduleView>> list(@PathVariable String scriptId) {
        return ApiResponse.success(support.listByScript(scriptId));
    }

    @PostMapping
    public ApiResponse<ScriptScheduleView> create(@PathVariable String scriptId,
                                                  @RequestBody ScriptScheduleUpsertRequest request) {
        return support.createSchedule(scriptId, request);
    }

    @PutMapping("/{scheduleId}")
    public ApiResponse<ScriptScheduleView> update(@PathVariable String scriptId,
                                                  @PathVariable String scheduleId,
                                                  @RequestBody ScriptScheduleUpsertRequest request) {
        return support.updateSchedule(scriptId, scheduleId, request);
    }

    @PostMapping("/{scheduleId}/enable")
    public ApiResponse<ScriptScheduleView> enable(@PathVariable String scriptId, @PathVariable String scheduleId) {
        return support.enableSchedule(scriptId, scheduleId);
    }

    @PostMapping("/{scheduleId}/disable")
    public ApiResponse<ScriptScheduleView> disable(@PathVariable String scriptId, @PathVariable String scheduleId) {
        return support.disableSchedule(scriptId, scheduleId);
    }

    @DeleteMapping("/{scheduleId}")
    public ApiResponse<Void> delete(@PathVariable String scriptId, @PathVariable String scheduleId) {
        return support.deleteSchedule(scriptId, scheduleId);
    }
}
