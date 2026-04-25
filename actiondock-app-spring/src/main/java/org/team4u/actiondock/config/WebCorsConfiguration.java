package org.team4u.actiondock.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web CORS 跨域配置。
 *
 * @author jay.wu
 */
@Configuration(proxyBeanMethods = false)
public class WebCorsConfiguration implements WebMvcConfigurer {
    /**
     * 配置 API 路径的 CORS 跨域策略。
     * <p>
     * 允许所有来源的 GET、POST、PUT、DELETE、OPTIONS 请求。
     *
     * @param registry CORS 注册器
     */
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns("*")
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .maxAge(3600);
    }
}
