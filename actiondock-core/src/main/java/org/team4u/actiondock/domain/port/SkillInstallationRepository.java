package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.SkillInstallation;

import java.util.List;
import java.util.Optional;

public interface SkillInstallationRepository {
    SkillInstallation save(SkillInstallation installation);

    Optional<SkillInstallation> findByInstallationId(String installationId);

    List<SkillInstallation> findAll();

    List<SkillInstallation> findBySkillId(String skillId);

    List<SkillInstallation> findByTargetId(String targetId);

    void deleteByInstallationId(String installationId);
}
