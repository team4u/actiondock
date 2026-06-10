package org.team4u.actiondock.web.ai;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.ai.api.AiCallContext;
import org.team4u.actiondock.ai.api.AiChatRequest;
import org.team4u.actiondock.ai.api.AiChatResponse;
import org.team4u.actiondock.ai.api.AiEmbeddingRequest;
import org.team4u.actiondock.ai.api.AiEmbeddingResponse;
import org.team4u.actiondock.ai.api.AiGateway;
import org.team4u.actiondock.ai.api.AiStructuredRequest;
import org.team4u.actiondock.ai.api.AiStructuredResponse;
import org.team4u.actiondock.web.common.ApiResponse;

@RestController
@RequestMapping("/api/ai")
public class AiGatewayController {

    private final AiGateway aiGateway;

    public AiGatewayController(AiGateway aiGateway) {
        this.aiGateway = aiGateway;
    }

    @PostMapping("/chat")
    public ApiResponse<AiChatResponse> chat(@RequestBody AiChatRequest request) {
        return ApiResponse.success(aiGateway.chat(request, AiCallContext.adminTest()));
    }

    @PostMapping("/structured")
    public ApiResponse<AiStructuredResponse> structured(@RequestBody AiStructuredRequest request) {
        return ApiResponse.success(aiGateway.structured(request, AiCallContext.adminTest()));
    }

    @PostMapping("/embed")
    public ApiResponse<AiEmbeddingResponse> embed(@RequestBody AiEmbeddingRequest request) {
        return ApiResponse.success(aiGateway.embed(request, AiCallContext.adminTest()));
    }
}
