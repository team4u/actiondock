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

    /**
     * 判断当前请求是否跳过认证过滤。
     * <p>
     * 仅对 /api/ 路径下的请求执行认证，其他路径跳过。
     *
     * @param request HTTP 请求
     * @return 非 API 请求返回 true（跳过过滤）
     */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return !path.startsWith("/api/");
    }

    /**
     * 执行 API Key 认证。
     * <p>
     * 从 Authorization 请求头中提取 Bearer Token，与配置的 API Key 列表比对。
     * 若未配置 API Key 则直接放行；若认证失败则返回 401 状态码。
     *
     * @param request HTTP 请求
     * @param response HTTP 响应
     * @param filterChain 过滤器链
     * @throws ServletException Servlet 异常
     * @throws IOException IO 异常
     */
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
