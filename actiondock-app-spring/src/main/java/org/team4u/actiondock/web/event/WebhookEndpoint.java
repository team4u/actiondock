package org.team4u.actiondock.web.event;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.application.WebhookExecutionApplicationService;
import org.team4u.actiondock.application.WebhookExecutionResult;
import org.team4u.actiondock.application.WebhookRequest;

import java.util.ArrayList;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
public class WebhookEndpoint {
    private final WebhookExecutionApplicationService webhookExecutionApplicationService;

    public WebhookEndpoint(WebhookExecutionApplicationService webhookExecutionApplicationService) {
        this.webhookExecutionApplicationService = webhookExecutionApplicationService;
    }

    @PostMapping(path = "/api/webhooks/{id}", consumes = {MediaType.APPLICATION_JSON_VALUE, MediaType.ALL_VALUE})
    public ResponseEntity<?> ingest(@PathVariable String id,
                                    HttpServletRequest request,
                                    @RequestBody(required = false) String rawBody) {
        WebhookExecutionResult result = webhookExecutionApplicationService.ingest(id, new WebhookRequest()
                .setMethod(request.getMethod())
                .setPath(request.getRequestURI())
                .setHeaders(readHeaders(request))
                .setQuery(readQuery(request))
                .setRawBody(rawBody)
                .setContentType(request.getContentType()));
        HttpHeaders headers = new HttpHeaders();
        result.getWebhookResponse().getHeaders().forEach((name, values) -> values.forEach(value -> headers.add(name, value)));
        return ResponseEntity.status(result.getWebhookResponse().getStatus())
                .headers(headers)
                .body(result.getWebhookResponse().getBody());
    }

    private static Map<String, List<String>> readHeaders(HttpServletRequest request) {
        Map<String, List<String>> headers = new LinkedHashMap<>();
        Enumeration<String> names = request.getHeaderNames();
        if (names == null) {
            return headers;
        }
        while (names.hasMoreElements()) {
            String name = names.nextElement();
            List<String> values = new ArrayList<>();
            Enumeration<String> headerValues = request.getHeaders(name);
            while (headerValues.hasMoreElements()) {
                values.add(headerValues.nextElement());
            }
            headers.put(name, List.copyOf(values));
        }
        return headers;
    }

    private static Map<String, List<String>> readQuery(HttpServletRequest request) {
        Map<String, List<String>> query = new LinkedHashMap<>();
        request.getParameterMap().forEach((key, value) -> query.put(key, value == null ? List.of() : List.of(value)));
        return query;
    }
}
