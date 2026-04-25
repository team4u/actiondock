package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.PluginRegistrationEntity;

import java.util.List;

/**
 * Spring Data JPA 插件注册实体仓储。
 *
 * @author jay.wu
 */
public interface SpringDataPluginRegistrationRepository extends JpaRepository<PluginRegistrationEntity, String> {
    List<PluginRegistrationEntity> findByEnabledTrueOrderByPluginIdAsc();
}
