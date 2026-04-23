package org.team4u.scriptflow.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;
import org.team4u.scriptflow.config.AppProperties;

import java.io.IOException;
import java.util.List;

/**
 * API Key 认证过滤器，通过 Bearer Token 验证 API 请求。
 *
 * @author jay.wu
 */
public class ApiKeyAuthFilter extends OncePerRequestFilter {
    private final AppProperties properties;

    public ApiKeyAuthFilter(AppProperties properties) {
        this.properties = properties;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return !path.startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        List<String> apiKeys = properties.getAuth().getApiKeys();
        if (apiKeys == null || apiKeys.isEmpty()) {
            filterChain.doFilter(request, response);
            return;
        }

        String authorization = request.getHeader("Authorization");
        String token = authorization == null ? null : authorization.replaceFirst("(?i)^Bearer\\s+", "");
        if (token == null || !apiKeys.contains(token)) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }

        filterChain.doFilter(request, response);
    }
}
