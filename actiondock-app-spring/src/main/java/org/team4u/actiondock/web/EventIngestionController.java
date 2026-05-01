package org.team4u.actiondock.web;

import com.fasterxml.jackson.databind.ObjectMapper;
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

import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/event-sources")
public class EventIngestionController {
    private final EventIngestionApplicationService eventIngestionApplicationService;
    private final ObjectMapper objectMapper;

    public EventIngestionController(EventIngestionApplicationService eventIngestionApplicationService,
                                    ObjectMapper objectMapper) {
        this.eventIngestionApplicationService = eventIngestionApplicationService;
        this.objectMapper = objectMapper;
    }

    @PostMapping(path = "/{id}/events", consumes = {MediaType.APPLICATION_JSON_VALUE, MediaType.ALL_VALUE})
    public ApiResponse<EventIngestionView> ingest(@PathVariable String id,
                                                  HttpServletRequest request,
                                                  @RequestBody(required = false) String rawBody) {
        EventIngestionResult result = eventIngestionApplicationService.ingest(id, new IncomingEventPayload()
                .setHeaders(readHeaders(request))
                .setQuery(readQuery(request))
                .setBody(readBody(rawBody))
                .setRawBody(rawBody)
                .setContentType(request.getContentType()));
        return ApiResponse.success(new EventIngestionView(result.getEventRecord(), result.getDispatches()), "已接收");
    }

    private Map<String, Object> readHeaders(HttpServletRequest request) {
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

    private Map<String, Object> readQuery(HttpServletRequest request) {
        Map<String, Object> query = new LinkedHashMap<>();
        request.getParameterMap().forEach((key, value) -> {
            if (value == null || value.length == 0) {
                query.put(key, null);
            } else if (value.length == 1) {
                query.put(key, value[0]);
            } else {
                query.put(key, java.util.List.of(value));
            }
        });
        return query;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> readBody(String rawBody) {
        if (rawBody == null || rawBody.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(rawBody, Map.class);
        } catch (Exception exception) {
            throw new IllegalArgumentException("请求体必须是 JSON 对象", exception);
        }
    }
}
