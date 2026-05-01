package org.team4u.actiondock.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.application.EventRecordApplicationService;
import org.team4u.actiondock.domain.model.EventDispatchRecord;
import org.team4u.actiondock.domain.model.EventRecord;

import java.util.List;

@RestController
@RequestMapping("/api/event-records")
public class EventRecordController {
    private final EventRecordApplicationService eventRecordApplicationService;

    public EventRecordController(EventRecordApplicationService eventRecordApplicationService) {
        this.eventRecordApplicationService = eventRecordApplicationService;
    }

    @GetMapping
    public ApiResponse<List<EventRecord>> list(@RequestParam(required = false) String sourceId) {
        return ApiResponse.success(sourceId == null || sourceId.isBlank()
                ? eventRecordApplicationService.listAll()
                : eventRecordApplicationService.listBySourceId(sourceId));
    }

    @GetMapping("/{id}")
    public ApiResponse<EventRecord> detail(@PathVariable String id) {
        return ApiResponse.success(eventRecordApplicationService.get(id));
    }

    @GetMapping("/{id}/dispatches")
    public ApiResponse<List<EventDispatchRecord>> dispatches(@PathVariable String id) {
        return ApiResponse.success(eventRecordApplicationService.listDispatches(id));
    }
}
