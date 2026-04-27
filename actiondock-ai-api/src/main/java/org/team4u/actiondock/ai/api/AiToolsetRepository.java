package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Optional;

public interface AiToolsetRepository {
    AiToolset save(AiToolset toolset);
    Optional<AiToolset> findById(String id);
    List<AiToolset> findAll();
    void deleteById(String id);
}
