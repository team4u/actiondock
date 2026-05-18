package org.team4u.actiondock.ai.api;

public interface AiProviderClient {
    AiChatResponse chat(AiModelProfile profile, AiChatRequest request, AiCallContext context);

    AiStructuredResponse structured(AiModelProfile profile, AiStructuredRequest request, AiCallContext context);

    AiEmbeddingResponse embed(AiModelProfile profile, AiEmbeddingRequest request, AiCallContext context);

    AiAgentRunResult runAgent(AiAgentProfile agentProfile,
                              AiModelProfile modelProfile,
                              AiAgentRunRequest request,
                              AiAgentRunContext context,
                              AiToolRegistry toolRegistry);

    default AiAgentRunResult runAgent(AiAgentProfile agentProfile,
                                      AiModelProfile modelProfile,
                                      AiAgentRunRequest request,
                                      AiAgentRunContext context,
                                      AiToolRegistry toolRegistry,
                                      AiAgentRunObserver observer) {
        return runAgent(agentProfile, modelProfile, request, context, toolRegistry);
    }
}
