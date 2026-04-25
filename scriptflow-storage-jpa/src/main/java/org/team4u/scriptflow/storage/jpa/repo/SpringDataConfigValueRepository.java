package org.team4u.scriptflow.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.scriptflow.storage.jpa.entity.ConfigValueEntity;

import java.util.List;

/**
 * Spring Data JPA 全局配置值实体仓储。
 *
 * @author jay.wu
 */
public interface SpringDataConfigValueRepository extends JpaRepository<ConfigValueEntity, String> {
    List<ConfigValueEntity> findAllByOrderByKeyAsc();
}
