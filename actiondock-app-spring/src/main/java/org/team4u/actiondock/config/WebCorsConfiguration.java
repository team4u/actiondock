package org.team4u.actiondock.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web CORS 跨域配置。
 * <p>
 * 允许通过 {@code app.cors.allowed-origins} 配置允许的跨域来源，默认允许所有来源。
 *
 * @author jay.wu
 */
@Configuration(proxyBeanMethods = false)
public class WebCorsConfiguration implements WebMvcConfigurer {
    private static final long CORS_MAX_AGE_SECONDS = 3600;

    private final AppProperties appProperties;

    public WebCorsConfiguration(AppProperties appProperties) {
        this.appProperties = appProperties;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns(appProperties.getCors().getAllowedOrigins().toArray(String[]::new))
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .maxAge(CORS_MAX_AGE_SECONDS);
    }
}
