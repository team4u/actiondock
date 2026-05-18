package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.CapabilityPackageInstallation;

import java.util.Optional;

/**
 * 已安装能力包仓储端口。
 */
public interface CapabilityPackageInstallationRepository {
    CapabilityPackageInstallation save(CapabilityPackageInstallation installation);

    Optional<CapabilityPackageInstallation> findByInstallationId(String installationId);

    Optional<CapabilityPackageInstallation> findByEntryAgentId(String entryAgentId);

    void deleteByInstallationId(String installationId);
}
