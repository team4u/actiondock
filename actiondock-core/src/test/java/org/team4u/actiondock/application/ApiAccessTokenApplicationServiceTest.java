package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.ApiAccessToken;
import org.team4u.actiondock.domain.port.ApiAccessTokenRepository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class ApiAccessTokenApplicationServiceTest {
    private final InMemoryApiAccessTokenRepository repository = new InMemoryApiAccessTokenRepository();
    private final ApiAccessTokenApplicationService service = new ApiAccessTokenApplicationService(repository);

    @Test
    void createReturnsPlainTokenButStoresOnlyHash() {
        ApiAccessTokenApplicationService.CreatedToken created = service.create("Local client");

        assertThat(created.token().getId()).isNotBlank();
        assertThat(created.tokenValue()).startsWith("adk_" + created.token().getId() + "_");
        assertThat(repository.findById(created.token().getId())).isPresent();
        assertThat(repository.findById(created.token().getId()).orElseThrow().getTokenHash())
                .isNotEqualTo(created.tokenValue());
    }

    @Test
    void authenticateUpdatesLastUsedAtAndRejectsDisabledToken() {
        ApiAccessTokenApplicationService.CreatedToken created = service.create("Local client");

        assertThat(service.authenticate(created.tokenValue())).isTrue();
        assertThat(repository.findById(created.token().getId()).orElseThrow().getLastUsedAt()).isNotNull();

        service.disable(created.token().getId());
        assertThat(service.authenticate(created.tokenValue())).isFalse();
    }

    @Test
    void hasAnyEnabledTokenOnlyCountsEnabledTokens() {
        ApiAccessTokenApplicationService.CreatedToken created = service.create("Local client");

        assertThat(service.hasAnyEnabledToken()).isTrue();

        service.disable(created.token().getId());
        assertThat(service.hasAnyEnabledToken()).isFalse();
    }

    private static final class InMemoryApiAccessTokenRepository implements ApiAccessTokenRepository {
        private final Map<String, ApiAccessToken> tokens = new LinkedHashMap<>();

        @Override
        public ApiAccessToken save(ApiAccessToken token) {
            ApiAccessToken copy = copy(token);
            tokens.put(copy.getId(), copy);
            return copy(copy);
        }

        @Override
        public Optional<ApiAccessToken> findById(String id) {
            return Optional.ofNullable(tokens.get(id)).map(InMemoryApiAccessTokenRepository::copy);
        }

        @Override
        public List<ApiAccessToken> findAll() {
            return tokens.values().stream().map(InMemoryApiAccessTokenRepository::copy).toList();
        }

        @Override
        public void deleteById(String id) {
            tokens.remove(id);
        }

        @Override
        public long count() {
            return tokens.size();
        }

        @Override
        public long countEnabled() {
            return tokens.values().stream().filter(ApiAccessToken::isEnabled).count();
        }

        private static ApiAccessToken copy(ApiAccessToken source) {
            return new ApiAccessToken()
                    .setId(source.getId())
                    .setName(source.getName())
                    .setTokenHash(source.getTokenHash())
                    .setTokenPreview(source.getTokenPreview())
                    .setEnabled(source.isEnabled())
                    .setCreatedAt(source.getCreatedAt())
                    .setUpdatedAt(source.getUpdatedAt())
                    .setLastUsedAt(source.getLastUsedAt());
        }
    }
}
