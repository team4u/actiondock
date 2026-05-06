package org.team4u.actiondock.auth;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.actiondock.application.ApiAccessTokenApplicationService;

/**
 * 认证模块配置，注册 API Key 认证过滤器。
 *
 * @author jay.wu
 */
@Configuration
public class AuthConfiguration {
    /**
     * 注册 API Key 认证过滤器，拦截 /api/* 路径的请求。
     *
     * @param apiAccessTokenApplicationService API 访问令牌服务
     * @return 过滤器注册 Bean
     */
    @Bean
    public FilterRegistrationBean<ApiKeyAuthFilter> apiKeyAuthFilter(ApiAccessTokenApplicationService apiAccessTokenApplicationService) {
        FilterRegistrationBean<ApiKeyAuthFilter> bean = new FilterRegistrationBean<>();
        bean.setFilter(new ApiKeyAuthFilter(apiAccessTokenApplicationService));
        bean.addUrlPatterns("/api/*");
        bean.setOrder(-100);
        return bean;
    }
}
