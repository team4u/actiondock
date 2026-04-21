package org.team4u.scriptflow.web;

import org.springframework.web.bind.annotation.*;
import org.team4u.scriptflow.application.PageRuntimeApplicationService;

import java.util.Map;

@RestController
@RequestMapping("/api/page-runtime")
public class PageRuntimeController {
    private final PageRuntimeApplicationService pageRuntimeApplicationService;

    public PageRuntimeController(PageRuntimeApplicationService pageRuntimeApplicationService) {
        this.pageRuntimeApplicationService = pageRuntimeApplicationService;
    }

    @GetMapping("/{id}/schema")
    public Map<String, Object> schema(@PathVariable String id) {
        return pageRuntimeApplicationService.schema(id);
    }

    @PostMapping("/{id}/actions/{actionId}")
    public ApiResponse<Map<String, Object>> action(@PathVariable String id,
                                                   @PathVariable String actionId,
                                                   @RequestBody(required = false) Map<String, Object> payload) {
        return ApiResponse.success(pageRuntimeApplicationService.runAction(id, actionId, payload));
    }
}
