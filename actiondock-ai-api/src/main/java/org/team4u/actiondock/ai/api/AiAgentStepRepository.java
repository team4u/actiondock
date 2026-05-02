package org.team4u.actiondock.ai.api;

import java.util.List;

public interface AiAgentStepRepository {
    AiAgentStep save(AiAgentStep step);
    List<AiAgentStep> findByRunId(String runId);
    void deleteByRunId(String runId);
}
