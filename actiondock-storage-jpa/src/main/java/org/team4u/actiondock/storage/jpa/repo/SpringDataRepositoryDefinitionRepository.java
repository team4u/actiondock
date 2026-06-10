package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.RepositoryDefinitionEntity;

/**
 * Spring Data JPA 仓库定义实体仓储。
 *
 * @author jay.wu
 */
public interface SpringDataRepositoryDefinitionRepository extends JpaRepository<RepositoryDefinitionEntity, String> {
}
