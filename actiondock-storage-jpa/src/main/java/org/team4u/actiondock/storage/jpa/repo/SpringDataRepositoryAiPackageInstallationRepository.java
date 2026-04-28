package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.RepositoryAiPackageInstallationEntity;

import java.util.Optional;

public interface SpringDataRepositoryAiPackageInstallationRepository extends JpaRepository<RepositoryAiPackageInstallationEntity, String> {
    Optional<RepositoryAiPackageInstallationEntity> findByEntryAgentId(String entryAgentId);
}
