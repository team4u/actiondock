package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Optional;

public interface AiModelProfileRepository {
    AiModelProfile save(AiModelProfile profile);
    Optional<AiModelProfile> findById(String id);
    List<AiModelProfile> findAll();
    void deleteById(String id);
}
