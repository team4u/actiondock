package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.ApiAccessToken;

import java.util.List;
import java.util.Optional;

/**
 * API 访问令牌仓储端口。
 *
 * @author jay.wu
 */
public interface ApiAccessTokenRepository {
    ApiAccessToken save(ApiAccessToken token);

    Optional<ApiAccessToken> findById(String id);

    List<ApiAccessToken> findAll();

    void deleteById(String id);

    long count();

    long countEnabled();
}
