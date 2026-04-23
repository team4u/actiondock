package org.team4u.scriptflow.domain.port;

import org.team4u.scriptflow.domain.model.ExecutionRecord;

import java.util.List;
import java.util.Optional;

/**
 * 执行记录仓储端口，提供执行记录的持久化操作。
 *
 * @author jay.wu
 */
public interface ExecutionRepository {
    ExecutionRecord save(ExecutionRecord record);

    Optional<ExecutionRecord> findById(String id);

    List<ExecutionRecord> findByScriptId(String scriptId);

    List<ExecutionRecord> findAll();

    void deleteById(String id);

    void deleteByScriptId(String scriptId);
}
