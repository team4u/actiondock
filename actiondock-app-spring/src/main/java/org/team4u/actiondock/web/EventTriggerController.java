package org.team4u.actiondock.web;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.application.EventTriggerApplicationService;
import org.team4u.actiondock.domain.model.EventDispatchRecord;
import org.team4u.actiondock.domain.model.EventTrigger;

import java.util.List;

@RestController
@RequestMapping("/api/event-triggers")
public class EventTriggerController {
    private final EventTriggerApplicationService eventTriggerApplicationService;

    public EventTriggerController(EventTriggerApplicationService eventTriggerApplicationService) {
        this.eventTriggerApplicationService = eventTriggerApplicationService;
    }

    @GetMapping
    public ApiResponse<List<EventTrigger>> list() {
        return ApiResponse.success(eventTriggerApplicationService.list());
    }

    @GetMapping("/{id}")
    public ApiResponse<EventTrigger> detail(@PathVariable String id) {
        return ApiResponse.success(eventTriggerApplicationService.get(id));
    }

    @PostMapping
    public ApiResponse<EventTrigger> create(@RequestBody EventTrigger request) {
        return ApiResponse.success(eventTriggerApplicationService.save(request), "已创建");
    }

    @PutMapping("/{id}")
    public ApiResponse<EventTrigger> update(@PathVariable String id, @RequestBody EventTrigger request) {
        request.setId(id);
        return ApiResponse.success(eventTriggerApplicationService.save(request), "已更新");
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable String id) {
        eventTriggerApplicationService.delete(id);
        return ApiResponse.success(null, "已删除");
    }

    @PostMapping("/{id}/enable")
    public ApiResponse<EventTrigger> enable(@PathVariable String id) {
        return ApiResponse.success(eventTriggerApplicationService.enable(id), "已启用");
    }

    @PostMapping("/{id}/disable")
    public ApiResponse<EventTrigger> disable(@PathVariable String id) {
        return ApiResponse.success(eventTriggerApplicationService.disable(id), "已停用");
    }

    @PostMapping("/{id}/test")
    public ApiResponse<EventTriggerApplicationService.TriggerTestResult> test(@PathVariable String id,
                                                                              @RequestBody EventTriggerTestRequest request) {
        return ApiResponse.success(eventTriggerApplicationService.test(id, request.getEvent(), request.isExecute()));
    }

    @GetMapping("/{id}/dispatches")
    public ApiResponse<List<EventDispatchRecord>> dispatches(@PathVariable String id) {
        return ApiResponse.success(eventTriggerApplicationService.listDispatches(id));
    }
}
