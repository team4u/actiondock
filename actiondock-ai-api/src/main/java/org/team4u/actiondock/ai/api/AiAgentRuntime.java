package org.team4u.actiondock.ai.api;

public interface AiAgentRuntime {
    AiAgentRunSubmission submit(AiAgentRunRequest request, AiAgentRunContext context);

    AiAgentRunResult run(AiAgentRunRequest request, AiAgentRunContext context);

    AiAgentRunResult resume(String runId, AiAgentResumeCommand command);

    void cancel(String runId);

    AiAgentRunSnapshot getRun(String runId);
}
