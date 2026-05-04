package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.SkillInstallationEntity;

import java.util.List;

public interface SpringDataSkillInstallationRepository extends JpaRepository<SkillInstallationEntity, String> {
    List<SkillInstallationEntity> findBySkillIdOrderByInstallationIdAsc(String skillId);

    List<SkillInstallationEntity> findByTargetIdOrderByInstallationIdAsc(String targetId);
}
