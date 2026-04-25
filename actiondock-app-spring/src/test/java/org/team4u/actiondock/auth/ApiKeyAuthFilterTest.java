package org.team4u.actiondock.auth;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.team4u.actiondock.config.AppProperties;

import static org.assertj.core.api.Assertions.assertThat;

class ApiKeyAuthFilterTest {
    @Test
    void nonApiRequestsBypassFiltering() throws Exception {
        ApiKeyAuthFilter filter = new ApiKeyAuthFilter(properties("secret"));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/health");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).isNotNull();
        assertThat(response.getStatus()).isEqualTo(200);
    }

    @Test
    void requestsPassThroughWhenNoApiKeysConfigured() throws Exception {
        ApiKeyAuthFilter filter = new ApiKeyAuthFilter(new AppProperties());
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/scripts");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).isNotNull();
        assertThat(response.getStatus()).isEqualTo(200);
    }

    @Test
    void validBearerTokenIsAccepted() throws Exception {
        ApiKeyAuthFilter filter = new ApiKeyAuthFilter(properties("secret"));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/scripts");
        request.addHeader("Authorization", "Bearer secret");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).isNotNull();
        assertThat(response.getStatus()).isEqualTo(200);
    }

    @Test
    void invalidOrMissingTokenReturnsUnauthorized() throws Exception {
        ApiKeyAuthFilter filter = new ApiKeyAuthFilter(properties("secret"));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/scripts");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(chain.getRequest()).isNull();
        assertThat(response.getStatus()).isEqualTo(401);
    }

    private static AppProperties properties(String... apiKeys) {
        AppProperties properties = new AppProperties();
        properties.getAuth().setApiKeys(java.util.List.of(apiKeys));
        return properties;
    }
}
