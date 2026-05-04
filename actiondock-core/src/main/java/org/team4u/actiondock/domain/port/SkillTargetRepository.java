package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.SkillTarget;

import java.util.List;
import java.util.Optional;

public interface SkillTargetRepository {
    SkillTarget save(SkillTarget target);

    Optional<SkillTarget> findById(String id);

    List<SkillTarget> findAll();

    void deleteById(String id);
}
