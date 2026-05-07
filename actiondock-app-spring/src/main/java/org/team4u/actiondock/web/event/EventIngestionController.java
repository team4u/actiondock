package org.team4u.actiondock.web.event;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.application.EventIngestionApplicationService;
import org.team4u.actiondock.application.EventIngestionResult;
import org.team4u.actiondock.application.IncomingEventPayload;
import org.team4u.actiondock.web.common.ApiResponse;

import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/event-sources")
public class EventIngestionController {
    private final EventIngestionApplicationService eventIngestionApplicationService;

    public EventIngestionController(EventIngestionApplicationService eventIngestionApplicationService) {
        this.eventIngestionApplicationService = eventIngestionApplicationService;
    }

    @PostMapping(path = "/{id}/events", consumes = {MediaType.APPLICATION_JSON_VALUE, MediaType.ALL_VALUE})
    public ApiResponse<EventIngestionView> ingest(@PathVariable String id,
                                                  HttpServletRequest request,
                                                  @RequestBody(required = false) String rawBody) {
        EventIngestionResult result = eventIngestionApplicationService.ingest(id, new IncomingEventPayload()
                .setHeaders(readHeaders(request))
                .setQuery(readQuery(request))
                .setRawBody(rawBody)
                .setContentType(request.getContentType()));
        return ApiResponse.success(new EventIngestionView(result.getEventRecord(), result.getDispatches()), "已接收");
    }

    private static Map<String, Object> readHeaders(HttpServletRequest request) {
        Map<String, Object> headers = new LinkedHashMap<>();
        Enumeration<String> names = request.getHeaderNames();
        if (names == null) {
            return headers;
        }
        while (names.hasMoreElements()) {
            String name = names.nextElement();
            headers.put(name, request.getHeader(name));
        }
        return headers;
    }

    private static Map<String, Object> readQuery(HttpServletRequest request) {
        Map<String, Object> query = new LinkedHashMap<>();
        request.getParameterMap().forEach((key, value) -> {
            if (value == null) {
                query.put(key, null);
            } else {
                switch (value.length) {
                    case 0 -> query.put(key, null);
                    case 1 -> query.put(key, value[0]);
                    default -> query.put(key, java.util.List.of(value));
                }
            }
        });
        return query;
    }
}
