package org.team4u.actiondock.web.event;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.application.EventRecordApplicationService;
import org.team4u.actiondock.application.EventSourceApplicationService;
import org.team4u.actiondock.application.IncomingEventPayload;
import org.team4u.actiondock.domain.model.EventRecord;
import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.NormalizedEvent;
import org.team4u.actiondock.domain.model.EventSourceScope;
import org.team4u.actiondock.repository.RepositoryCatalogTypes;
import org.team4u.actiondock.repository.RepositoryEventSourceService;
import org.team4u.actiondock.web.common.ApiResponse;

import java.util.List;

@RestController
@RequestMapping("/api/event-sources")
public class EventSourceController {
    private final EventSourceApplicationService eventSourceApplicationService;
    private final EventRecordApplicationService eventRecordApplicationService;
    private final RepositoryEventSourceService repositoryEventSourceService;

    public EventSourceController(EventSourceApplicationService eventSourceApplicationService,
                                 EventRecordApplicationService eventRecordApplicationService,
                                 RepositoryEventSourceService repositoryEventSourceService) {
        this.eventSourceApplicationService = eventSourceApplicationService;
        this.eventRecordApplicationService = eventRecordApplicationService;
        this.repositoryEventSourceService = repositoryEventSourceService;
    }

    @GetMapping
    public ApiResponse<List<EventSourceDefinition>> list() {
        return ApiResponse.success(eventSourceApplicationService.list());
    }

    @GetMapping("/{id}")
    public ApiResponse<EventSourceDefinition> detail(@PathVariable String id) {
        return ApiResponse.success(eventSourceApplicationService.get(id));
    }

    @PostMapping
    public ApiResponse<EventSourceDefinition> create(@RequestBody EventSourceDefinition request) {
        request.setScope(request.getScope() == null ? EventSourceScope.PERSONAL : request.getScope());
        return ApiResponse.success(eventSourceApplicationService.save(request), "已创建");
    }

    @PutMapping("/{id}")
    public ApiResponse<EventSourceDefinition> update(@PathVariable String id, @RequestBody EventSourceDefinition request) {
        request.setId(id);
        return ApiResponse.success(eventSourceApplicationService.save(request), "已更新");
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable String id) {
        eventSourceApplicationService.delete(id);
        return ApiResponse.success(null, "已删除");
    }

    @PostMapping("/{id}/enable")
    public ApiResponse<EventSourceDefinition> enable(@PathVariable String id) {
        return ApiResponse.success(eventSourceApplicationService.enable(id), "已启用");
    }

    @PostMapping("/{id}/disable")
    public ApiResponse<EventSourceDefinition> disable(@PathVariable String id) {
        return ApiResponse.success(eventSourceApplicationService.disable(id), "已停用");
    }

    @PostMapping("/{id}/test-normalization")
    public ApiResponse<NormalizedEvent> testNormalization(@PathVariable String id,
                                                          @RequestBody(required = false) IncomingEventPayload payload) {
        return ApiResponse.success(eventSourceApplicationService.testNormalization(id, payload));
    }

    @GetMapping("/{id}/events")
    public ApiResponse<List<EventRecord>> listEvents(@PathVariable String id,
                                                     @RequestParam(required = false) Integer limit) {
        List<EventRecord> records = eventRecordApplicationService.listBySourceId(id);
        if (limit != null && limit > 0) {
            records = records.stream().limit(limit).toList();
        }
        return ApiResponse.success(records);
    }

    @GetMapping("/{id}/development-status")
    public ApiResponse<RepositoryCatalogTypes.DevelopmentStatus> developmentStatus(@PathVariable String id) {
        return ApiResponse.success(repositoryEventSourceService.getDevelopmentStatus(id));
    }

    @PostMapping("/{id}/development-pull")
    public ApiResponse<EventSourceDefinition> developmentPull(@PathVariable String id,
                                                              @RequestParam(defaultValue = "false") boolean force) {
        return ApiResponse.success(repositoryEventSourceService.pullDevelopmentEventSource(id, force), "开发事件源已拉取远端更新");
    }
}
