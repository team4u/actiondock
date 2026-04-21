package org.team4u.scriptflow.domain.port;

import org.team4u.scriptflow.domain.model.ExecutionRecord;

import java.util.List;
import java.util.Optional;

public interface ExecutionRepository {
    ExecutionRecord save(ExecutionRecord record);

    Optional<ExecutionRecord> findById(String id);

    List<ExecutionRecord> findByScriptId(String scriptId);

    List<ExecutionRecord> findAll();
}
