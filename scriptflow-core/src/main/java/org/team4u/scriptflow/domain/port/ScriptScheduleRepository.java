package org.team4u.scriptflow.domain.port;

import org.team4u.scriptflow.domain.model.ScriptSchedule;

import java.util.List;
import java.util.Optional;

public interface ScriptScheduleRepository {
    ScriptSchedule save(ScriptSchedule schedule);

    Optional<ScriptSchedule> findById(String id);

    List<ScriptSchedule> findAll();

    List<ScriptSchedule> findByScriptId(String scriptId);

    List<ScriptSchedule> findEnabled();

    void deleteById(String id);

    void deleteByScriptId(String scriptId);
}
