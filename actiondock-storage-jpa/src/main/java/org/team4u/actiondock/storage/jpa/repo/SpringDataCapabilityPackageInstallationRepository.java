package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.CapabilityPackageInstallationEntity;

import java.util.Optional;

public interface SpringDataCapabilityPackageInstallationRepository extends JpaRepository<CapabilityPackageInstallationEntity, String> {
    Optional<CapabilityPackageInstallationEntity> findByEntryAgentId(String entryAgentId);
}
