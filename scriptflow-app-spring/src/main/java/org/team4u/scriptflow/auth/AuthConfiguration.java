package org.team4u.scriptflow.auth;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.scriptflow.config.AppProperties;

@Configuration
public class AuthConfiguration {
    @Bean
    public FilterRegistrationBean<ApiKeyAuthFilter> apiKeyAuthFilter(AppProperties properties) {
        FilterRegistrationBean<ApiKeyAuthFilter> bean = new FilterRegistrationBean<>();
        bean.setFilter(new ApiKeyAuthFilter(properties));
        bean.addUrlPatterns("/api/*");
        bean.setOrder(-100);
        return bean;
    }
}
