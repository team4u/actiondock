package org.team4u.actiondock.ai.api;

import java.util.List;

public interface AiCallLogRepository {
    AiCallLog save(AiCallLog log);
    List<AiCallLog> findAll();
}
