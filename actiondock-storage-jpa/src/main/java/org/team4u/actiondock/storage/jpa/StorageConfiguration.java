package org.team4u.actiondock.storage.jpa;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.storage.jpa.json.JacksonJsonCodec;

/**
 * JPA 存储层配置，注册 JSON 编解码器 Bean。
 * <p>
 * 仓储端口适配器通过 {@code @Component} 自动注册，
 * 通过 {@code @ComponentScan} 扫描 adapter 包发现。
 *
 * @author jay.wu
 */
@Configuration
@ComponentScan(basePackageClasses = StorageConfiguration.class)
public class StorageConfiguration {
    /**
     * 注册基于 Jackson 的 JSON 编解码器。
     *
     * @param objectMapper Jackson ObjectMapper
     * @return JSON 编解码器实现
     */
    @Bean
    public JsonCodec jsonCodec(ObjectMapper objectMapper) {
        return new JacksonJsonCodec(objectMapper);
    }
}
