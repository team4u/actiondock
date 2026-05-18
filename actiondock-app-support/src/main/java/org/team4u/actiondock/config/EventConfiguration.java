package org.team4u.actiondock.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.actiondock.application.WebhookApplicationService;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.WebhookExecutionApplicationService;
import org.team4u.actiondock.domain.port.WebhookRepository;
import org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;

/**
 * 事件相关配置，注册Webhook与 webhook 执行相关 Bean。
 *
 * @author jay.wu
 */
@Configuration(proxyBeanMethods = false)
public class EventConfiguration {

    @Bean
    public WebhookApplicationService webhookApplicationService(WebhookRepository webhookRepository,
                                                                       RepositoryLocalAssetRepository repositoryLocalAssetRepository,
                                                                       ScriptRepository scriptRepository) {
        return new WebhookApplicationService(
                webhookRepository,
                repositoryLocalAssetRepository,
                scriptRepository
        );
    }

    @Bean
    public WebhookExecutionApplicationService webhookExecutionApplicationService(WebhookApplicationService webhookApplicationService,
                                                                                 ExecutionApplicationService executionApplicationService) {
        return new WebhookExecutionApplicationService(
                webhookApplicationService,
                executionApplicationService
        );
    }
}
