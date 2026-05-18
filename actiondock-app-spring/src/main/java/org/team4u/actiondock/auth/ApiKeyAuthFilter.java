package org.team4u.actiondock.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;
import org.team4u.actiondock.application.ApiAccessTokenApplicationService;

import java.io.IOException;

/**
 * API Key 认证过滤器，通过 Bearer Token 验证 API 请求。
 *
 * @author jay.wu
 */
public class ApiKeyAuthFilter extends OncePerRequestFilter {
    private final ApiAccessTokenApplicationService apiAccessTokenApplicationService;

    public ApiKeyAuthFilter(ApiAccessTokenApplicationService apiAccessTokenApplicationService) {
        this.apiAccessTokenApplicationService = apiAccessTokenApplicationService;
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
        return !path.startsWith("/api/")
                || ("POST".equalsIgnoreCase(request.getMethod())
                && path.matches("^/api/webhooks/[^/]+$"));
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
        if (!apiAccessTokenApplicationService.hasAnyEnabledToken()) {
            filterChain.doFilter(request, response);
            return;
        }

        String authorization = request.getHeader("Authorization");
        String token = authorization == null ? null : authorization.replaceFirst("(?i)^Bearer\\s+", "");
        if (token == null || !apiAccessTokenApplicationService.authenticate(token)) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }

        filterChain.doFilter(request, response);
    }
}
