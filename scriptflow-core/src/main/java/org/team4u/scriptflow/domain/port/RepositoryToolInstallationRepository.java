package org.team4u.scriptflow.domain.port;

import org.team4u.scriptflow.domain.model.RepositoryToolInstallation;

import java.util.List;
import java.util.Optional;

/**
 * 已安装仓库工具仓储端口。
 *
 * @author jay.wu
 */
public interface RepositoryToolInstallationRepository {
    RepositoryToolInstallation save(RepositoryToolInstallation installation);

    Optional<RepositoryToolInstallation> findByToolId(String toolId);

    List<RepositoryToolInstallation> findAll();

    void deleteByToolId(String toolId);
}
