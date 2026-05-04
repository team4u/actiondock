package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.ManagedSkill;

import java.util.List;
import java.util.Optional;

public interface ManagedSkillRepository {
    ManagedSkill save(ManagedSkill skill);

    Optional<ManagedSkill> findBySkillId(String skillId);

    List<ManagedSkill> findAll();

    void deleteBySkillId(String skillId);
}
