package org.team4u.actiondock.web.ai;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.ai.api.AiCallContext;
import org.team4u.actiondock.ai.api.AiChatRequest;
import org.team4u.actiondock.ai.api.AiChatResponse;
import org.team4u.actiondock.ai.api.AiGateway;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.core.AiModelProfileService;
import org.team4u.actiondock.web.common.ApiResponse;

import java.util.List;

@RestController
@RequestMapping("/api/ai/models")
public class AiModelController {

    private final AiModelProfileService modelProfileService;
    private final AiGateway aiGateway;

    public AiModelController(AiModelProfileService modelProfileService,
                             AiGateway aiGateway) {
        this.modelProfileService = modelProfileService;
        this.aiGateway = aiGateway;
    }

    @GetMapping
    public ApiResponse<List<AiModelProfile>> listModels(@org.springframework.web.bind.annotation.RequestParam(defaultValue = "false") boolean includeManaged) {
        return ApiResponse.success(modelProfileService.list(includeManaged));
    }

    @PostMapping
    public ApiResponse<AiModelProfile> createModel(@RequestBody AiModelProfile profile) {
        return ApiResponse.success(modelProfileService.save(profile));
    }

    @GetMapping("/{id}")
    public ApiResponse<AiModelProfile> getModel(@PathVariable String id) {
        return ApiResponse.success(modelProfileService.get(id));
    }

    @PutMapping("/{id}")
    public ApiResponse<AiModelProfile> updateModel(@PathVariable String id, @RequestBody AiModelProfile profile) {
        profile.setId(id);
        return ApiResponse.success(modelProfileService.save(profile));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> deleteModel(@PathVariable String id) {
        modelProfileService.delete(id);
        return ApiResponse.success(null);
    }

    @PostMapping("/{id}/test")
    public ApiResponse<AiChatResponse> testModel(@PathVariable String id, @RequestBody AiChatRequest request) {
        AiChatRequest testRequest = new AiChatRequest(id, request == null ? List.of() : request.messages(), request == null ? null : request.options());
        return ApiResponse.success(aiGateway.chat(testRequest, AiCallContext.adminTest()));
    }
}
