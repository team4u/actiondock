package org.team4u.actiondock.ai.api;

import java.util.List;
import java.util.Optional;

public interface AiToolProvider {
    List<AiTool> listTools();

    Optional<AiTool> findTool(String name);
}
