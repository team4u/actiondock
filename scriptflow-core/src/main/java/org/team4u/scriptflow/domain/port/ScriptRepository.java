package org.team4u.scriptflow.domain.port;

import org.team4u.scriptflow.domain.model.ScriptDefinition;

import java.util.List;
import java.util.Optional;

public interface ScriptRepository {
    ScriptDefinition save(ScriptDefinition definition);

    Optional<ScriptDefinition> findById(String id);

    List<ScriptDefinition> findAll();

    void deleteById(String id);
}
