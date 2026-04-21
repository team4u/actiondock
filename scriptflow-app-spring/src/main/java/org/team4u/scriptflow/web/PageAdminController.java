package org.team4u.scriptflow.web;

import org.springframework.web.bind.annotation.*;
import org.team4u.scriptflow.application.PageDefinitionApplicationService;
import org.team4u.scriptflow.application.PageRuntimeApplicationService;
import org.team4u.scriptflow.domain.model.PageDefinition;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/pages")
public class PageAdminController {
    private final PageDefinitionApplicationService pageDefinitionApplicationService;
    private final PageRuntimeApplicationService pageRuntimeApplicationService;

    public PageAdminController(PageDefinitionApplicationService pageDefinitionApplicationService,
                               PageRuntimeApplicationService pageRuntimeApplicationService) {
        this.pageDefinitionApplicationService = pageDefinitionApplicationService;
        this.pageRuntimeApplicationService = pageRuntimeApplicationService;
    }

    @GetMapping
    public ApiResponse<List<PageDefinition>> list() {
        return ApiResponse.success(pageDefinitionApplicationService.list());
    }

    @PostMapping
    public ApiResponse<PageDefinition> save(@RequestBody PageDefinition definition) {
        return ApiResponse.success(pageDefinitionApplicationService.save(definition));
    }

    @GetMapping("/{id}")
    public ApiResponse<PageDefinition> detail(@PathVariable String id) {
        return ApiResponse.success(pageDefinitionApplicationService.get(id));
    }

    @PutMapping("/{id}")
    public ApiResponse<PageDefinition> update(@PathVariable String id, @RequestBody PageDefinition definition) {
        definition.setId(id);
        return ApiResponse.success(pageDefinitionApplicationService.save(definition));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable String id) {
        pageDefinitionApplicationService.delete(id);
        return ApiResponse.success(null);
    }

    @PostMapping("/{pageId}/scaffold-from-script/{scriptId}")
    public ApiResponse<PageDefinition> scaffold(@PathVariable String pageId, @PathVariable String scriptId) {
        return ApiResponse.success(pageDefinitionApplicationService.scaffold(pageId, scriptId));
    }

    @PostMapping("/{id}/submit")
    public ApiResponse<Map<String, Object>> submit(@PathVariable String id, @RequestBody(required = false) Map<String, Object> payload) {
        return ApiResponse.success(pageRuntimeApplicationService.submit(id, payload));
    }
}
