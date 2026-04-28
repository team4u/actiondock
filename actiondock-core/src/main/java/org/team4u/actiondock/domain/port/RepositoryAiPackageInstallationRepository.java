package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.RepositoryAiPackageInstallation;

import java.util.List;
import java.util.Optional;

/**
 * 已安装仓库 AI 能力包仓储端口。
 */
public interface RepositoryAiPackageInstallationRepository {
    RepositoryAiPackageInstallation save(RepositoryAiPackageInstallation installation);

    Optional<RepositoryAiPackageInstallation> findByInstallationId(String installationId);

    Optional<RepositoryAiPackageInstallation> findByEntryAgentId(String entryAgentId);

    List<RepositoryAiPackageInstallation> findAll();

    void deleteByInstallationId(String installationId);
}
