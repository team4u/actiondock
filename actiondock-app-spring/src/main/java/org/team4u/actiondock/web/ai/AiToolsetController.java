package org.team4u.actiondock.web.ai;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.core.AiToolsetService;
import org.team4u.actiondock.web.common.ApiResponse;

import java.util.List;

@RestController
@RequestMapping("/api/ai/toolsets")
public class AiToolsetController {

    private final AiToolsetService toolsetService;

    public AiToolsetController(AiToolsetService toolsetService) {
        this.toolsetService = toolsetService;
    }

    @GetMapping
    public ApiResponse<List<AiToolset>> listToolsets(@org.springframework.web.bind.annotation.RequestParam(defaultValue = "false") boolean includeManaged) {
        return ApiResponse.success(toolsetService.list(includeManaged));
    }

    @PostMapping
    public ApiResponse<AiToolset> createToolset(@RequestBody AiToolset toolset) {
        return ApiResponse.success(toolsetService.save(toolset));
    }

    @GetMapping("/{id}")
    public ApiResponse<AiToolset> getToolset(@PathVariable String id) {
        return ApiResponse.success(toolsetService.get(id));
    }

    @PutMapping("/{id}")
    public ApiResponse<AiToolset> updateToolset(@PathVariable String id, @RequestBody AiToolset toolset) {
        toolset.setId(id);
        return ApiResponse.success(toolsetService.save(toolset));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> deleteToolset(@PathVariable String id) {
        toolsetService.delete(id);
        return ApiResponse.success(null);
    }
}
