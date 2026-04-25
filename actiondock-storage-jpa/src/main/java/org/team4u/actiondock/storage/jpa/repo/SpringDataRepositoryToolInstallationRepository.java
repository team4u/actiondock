package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.RepositoryToolInstallationEntity;

/**
 * Spring Data JPA 仓库工具安装实体仓储。
 *
 * @author jay.wu
 */
public interface SpringDataRepositoryToolInstallationRepository extends JpaRepository<RepositoryToolInstallationEntity, String> {
}
