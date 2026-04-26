package org.team4u.actiondock.storage.jpa.adapter;

import org.team4u.actiondock.domain.model.ApiAccessToken;
import org.team4u.actiondock.domain.port.ApiAccessTokenRepository;
import org.team4u.actiondock.storage.jpa.entity.ApiAccessTokenEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataApiAccessTokenRepository;

import java.util.List;
import java.util.Optional;

/**
 * JPA API 访问令牌仓储适配器。
 *
 * @author jay.wu
 */
public class JpaApiAccessTokenRepositoryAdapter implements ApiAccessTokenRepository {
    private final SpringDataApiAccessTokenRepository repository;

    public JpaApiAccessTokenRepositoryAdapter(SpringDataApiAccessTokenRepository repository) {
        this.repository = repository;
    }

    @Override
    public ApiAccessToken save(ApiAccessToken token) {
        return toDomain(repository.save(toEntity(token)));
    }

    @Override
    public Optional<ApiAccessToken> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<ApiAccessToken> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    @Override
    public long count() {
        return repository.count();
    }

    private ApiAccessTokenEntity toEntity(ApiAccessToken token) {
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

    private ApiAccessToken toDomain(ApiAccessTokenEntity entity) {
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
