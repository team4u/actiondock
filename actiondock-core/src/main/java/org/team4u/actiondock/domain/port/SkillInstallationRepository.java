package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.SkillInstallation;

import java.util.List;
import java.util.Optional;

public interface SkillInstallationRepository {
    SkillInstallation save(SkillInstallation installation);

    Optional<SkillInstallation> findBySkillIdAndTargetId(String skillId, String targetId);

    List<SkillInstallation> findAll();

    List<SkillInstallation> findBySkillId(String skillId);

    List<SkillInstallation> findByTargetId(String targetId);

    void deleteBySkillIdAndTargetId(String skillId, String targetId);
}
