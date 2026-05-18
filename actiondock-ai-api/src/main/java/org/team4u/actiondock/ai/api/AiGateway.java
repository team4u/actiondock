package org.team4u.actiondock.ai.api;

public interface AiGateway {
    AiChatResponse chat(AiChatRequest request, AiCallContext context);

    AiStructuredResponse structured(AiStructuredRequest request, AiCallContext context);

    AiEmbeddingResponse embed(AiEmbeddingRequest request, AiCallContext context);
}
