package org.team4u.actiondock.auth;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.team4u.actiondock.application.ApiAccessTokenApplicationService;
import org.team4u.actiondock.domain.model.ApiAccessToken;
import org.team4u.actiondock.domain.port.ApiAccessTokenRepository;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class ApiKeyAuthFilterTest {
    @Test
    void nonApiRequestsBypassFiltering() throws Exception {
        ApiKeyAuthFilter filter = new ApiKeyAuthFilter(serviceWithToken("Platform token", "adk_1234_secret"));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/health");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).isNotNull();
        assertThat(response.getStatus()).isEqualTo(200);
    }

    @Test
    void requestsPassThroughWhenNoApiKeysConfigured() throws Exception {
        ApiKeyAuthFilter filter = new ApiKeyAuthFilter(new ApiAccessTokenApplicationService(new InMemoryApiAccessTokenRepository()));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/scripts");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).isNotNull();
        assertThat(response.getStatus()).isEqualTo(200);
    }

    @Test
    void validBearerTokenIsAccepted() throws Exception {
        ApiKeyAuthFilter filter = new ApiKeyAuthFilter(serviceWithToken("Platform token", "adk_1234_secret"));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/scripts");
        request.addHeader("Authorization", "Bearer adk_1234_secret");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).isNotNull();
        assertThat(response.getStatus()).isEqualTo(200);
    }

    @Test
    void invalidOrMissingTokenReturnsUnauthorized() throws Exception {
        ApiKeyAuthFilter filter = new ApiKeyAuthFilter(serviceWithToken("Platform token", "adk_1234_secret"));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/scripts");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).isNull();
        assertThat(response.getStatus()).isEqualTo(401);
    }

    @Test
    void requestsPassThroughWhenAllTokensAreDisabled() throws Exception {
        InMemoryApiAccessTokenRepository repository = new InMemoryApiAccessTokenRepository();
        repository.replaceToken("1234", "adk_1234_secret", "Platform token");
        ApiAccessToken token = repository.findById("1234").orElseThrow();
        repository.save(token.setEnabled(false));

        ApiKeyAuthFilter filter = new ApiKeyAuthFilter(new ApiAccessTokenApplicationService(repository));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/scripts");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).isNotNull();
        assertThat(response.getStatus()).isEqualTo(200);
    }

    private static ApiAccessTokenApplicationService serviceWithToken(String name, String rawToken) {
        InMemoryApiAccessTokenRepository repository = new InMemoryApiAccessTokenRepository();
        repository.replaceToken("1234", rawToken, name);
        return new ApiAccessTokenApplicationService(repository);
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

        void replaceToken(String id, String rawToken, String name) {
            LocalDateTime now = LocalDateTime.now();
            tokens.put(id, new ApiAccessToken()
                    .setId(id)
                    .setName(name)
                    .setTokenHash(hash(rawToken))
                    .setTokenPreview("****cret")
                    .setEnabled(true)
                    .setCreatedAt(now)
                    .setUpdatedAt(now));
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

        private static String hash(String rawToken) {
            try {
                return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
                        .digest(rawToken.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            } catch (java.security.NoSuchAlgorithmException exception) {
                throw new IllegalStateException(exception);
            }
        }
    }
}
