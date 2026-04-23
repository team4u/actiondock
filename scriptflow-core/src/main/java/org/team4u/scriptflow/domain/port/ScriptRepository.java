package org.team4u.scriptflow.domain.port;

import org.team4u.scriptflow.domain.model.ScriptDefinition;

import java.util.List;
import java.util.Optional;

/**
 * 脚本定义仓储端口，提供脚本定义的持久化操作。
 *
 * @author jay.wu
 */
public interface ScriptRepository {
    ScriptDefinition save(ScriptDefinition definition);

    Optional<ScriptDefinition> findById(String id);

    List<ScriptDefinition> findAll();

    void deleteById(String id);
}
