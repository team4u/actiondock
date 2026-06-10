package org.team4u.actiondock.web.ai;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.ai.api.AiCallerType;
import org.team4u.actiondock.ai.api.AiToolDescriptor;
import org.team4u.actiondock.ai.api.AiToolExecutionContext;
import org.team4u.actiondock.ai.api.AiToolExecutionResult;
import org.team4u.actiondock.ai.core.AiToolRegistryImpl;
import org.team4u.actiondock.web.common.ApiResponse;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/ai/tools")
public class AiToolController {

    private final AiToolRegistryImpl toolRegistry;

    public AiToolController(AiToolRegistryImpl toolRegistry) {
        this.toolRegistry = toolRegistry;
    }

    @GetMapping
    public ApiResponse<List<AiToolDescriptor>> listTools() {
        return ApiResponse.success(toolRegistry.listTools(null).stream().map(AiToolDescriptor::from).toList());
    }

    @GetMapping("/{name}")
    public ApiResponse<AiToolDescriptor> getTool(@PathVariable String name) {
        return ApiResponse.success(AiToolDescriptor.from(toolRegistry.getTool(name)));
    }

    @PostMapping("/{name}/test")
    public ApiResponse<AiToolExecutionResult> testTool(@PathVariable String name, @RequestBody(required = false) Map<String, Object> input) {
        return ApiResponse.success(toolRegistry.invoke(name, input, new AiToolExecutionContext(
                null,
                null,
                AiCallerType.ADMIN_TEST,
                null,
                null,
                null,
                Map.of("maxToolPermission", "CONTROLLED_ACTION")
        )));
    }
}
