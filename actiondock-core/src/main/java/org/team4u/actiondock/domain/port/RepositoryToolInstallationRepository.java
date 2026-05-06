package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.RepositoryToolInstallation;

import java.util.Optional;

/**
 * 已安装仓库工具仓储端口。
 *
 * @author jay.wu
 */
public interface RepositoryToolInstallationRepository {
    RepositoryToolInstallation save(RepositoryToolInstallation installation);

    Optional<RepositoryToolInstallation> findByToolId(String toolId);

    void deleteByToolId(String toolId);
}
