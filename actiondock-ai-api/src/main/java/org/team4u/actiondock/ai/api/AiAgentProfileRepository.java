package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Optional;

public interface AiAgentProfileRepository {
    AiAgentProfile save(AiAgentProfile profile);
    Optional<AiAgentProfile> findById(String id);
    List<AiAgentProfile> findAll();
    void deleteById(String id);
}
