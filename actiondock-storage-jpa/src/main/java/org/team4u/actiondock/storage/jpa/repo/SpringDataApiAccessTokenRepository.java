package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.ApiAccessTokenEntity;

/**
 * Spring Data API 访问令牌仓储。
 *
 * @author jay.wu
 */
public interface SpringDataApiAccessTokenRepository extends JpaRepository<ApiAccessTokenEntity, String> {
    long countByEnabledTrue();
}
