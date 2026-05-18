package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Optional;

public interface AiAgentRunRepository {
    AiAgentRunRecord save(AiAgentRunRecord run);
    Optional<AiAgentRunRecord> findById(String id);
    List<AiAgentRunRecord> findAll();
    void deleteById(String id);
}
