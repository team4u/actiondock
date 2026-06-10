package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;

import org.team4u.actiondock.domain.model.ApiAccessToken;
import org.team4u.actiondock.domain.port.ApiAccessTokenRepository;
import org.team4u.actiondock.storage.jpa.entity.ApiAccessTokenEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataApiAccessTokenRepository;

/**
 * JPA API 访问令牌仓储适配器。
 *
 * @author jay.wu
 */
@Component
public class JpaApiAccessTokenRepositoryAdapter
        extends AbstractJpaRepositoryAdapter<ApiAccessTokenEntity, ApiAccessToken, SpringDataApiAccessTokenRepository>
        implements ApiAccessTokenRepository {

    public JpaApiAccessTokenRepositoryAdapter(SpringDataApiAccessTokenRepository repository) {
        super(repository);
    }

    @Override
    public long count() {
        return repository.count();
    }

    @Override
    public long countEnabled() {
        return repository.countByEnabledTrue();
    }

    @Override
    protected ApiAccessTokenEntity toEntity(ApiAccessToken token) {
        ApiAccessTokenEntity entity = new ApiAccessTokenEntity();
        entity.setId(token.getId());
        entity.setName(token.getName());
        entity.setTokenHash(token.getTokenHash());
        entity.setTokenPreview(token.getTokenPreview());
        entity.setEnabled(token.isEnabled());
        entity.setCreatedAt(token.getCreatedAt());
        entity.setUpdatedAt(token.getUpdatedAt());
        entity.setLastUsedAt(token.getLastUsedAt());
        return entity;
    }

    @Override
    protected ApiAccessToken toDomain(ApiAccessTokenEntity entity) {
        return new ApiAccessToken()
                .setId(entity.getId())
                .setName(entity.getName())
                .setTokenHash(entity.getTokenHash())
                .setTokenPreview(entity.getTokenPreview())
                .setEnabled(entity.isEnabled())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt())
                .setLastUsedAt(entity.getLastUsedAt());
    }
}
