package org.team4u.actiondock.config;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.actiondock.application.ApiAccessTokenApplicationService;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.ExecutionPresetApplicationService;
import org.team4u.actiondock.application.ProcessorApplicationService;
import org.team4u.actiondock.application.SharedStateApplicationService;
import org.team4u.actiondock.domain.port.ApiAccessTokenRepository;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.ExecutionPresetRepository;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.domain.port.ProcessorEngine;
import org.team4u.actiondock.domain.port.SharedStateRepository;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.processor.DefaultProcessorEngine;
import org.team4u.actiondock.application.ScriptInvocationService;

import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/**
 * 运行时核心配置，注册通用应用服务和基础设施 Bean。
 * <p>
 * 领域特定的配置已拆分到独立的 Configuration 类中：
 * <ul>
 *     <li>{@link AiConfiguration} — AI 相关</li>
 *     <li>{@link RepositoryConfiguration} — 仓库相关</li>
 *     <li>{@link ScriptConfiguration} — 脚本引擎相关</li>
 *     <li>{@link EventConfiguration} — 事件相关</li>
 *     <li>{@link PluginConfiguration} — 插件相关</li>
 *     <li>{@link SkillConfiguration} — 技能相关</li>
 *     <li>{@link ScheduleConfiguration} — 调度相关</li>
 * </ul>
 *
 * @author jay.wu
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(AppProperties.class)
public class RuntimeConfiguration {

    @Bean(destroyMethod = "shutdown")
    public Executor executionExecutor(AppProperties properties) {
        return Executors.newFixedThreadPool(properties.getExecution().getAsyncPoolSize());
    }

    @Bean
    public ConfigValueApplicationService configValueApplicationService(ConfigValueRepository configValueRepository) {
        return new ConfigValueApplicationService(configValueRepository);
    }

    @Bean
    public ApiAccessTokenApplicationService apiAccessTokenApplicationService(ApiAccessTokenRepository apiAccessTokenRepository) {
        return new ApiAccessTokenApplicationService(apiAccessTokenRepository);
    }

    @Bean
    public SharedStateApplicationService sharedStateApplicationService(SharedStateRepository sharedStateRepository) {
        return new SharedStateApplicationService(sharedStateRepository);
    }

    @Bean
    public ExecutionApplicationService executionApplicationService(ScriptRepository scriptRepository,
                                                                   ExecutionRepository executionRepository,
                                                                   ScriptEngine scriptEngine,
                                                                   @Qualifier("executionExecutor") Executor executor,
                                                                   ConfigValueApplicationService configValueApplicationService) {
        return new ExecutionApplicationService(scriptRepository, executionRepository, scriptEngine, executor, configValueApplicationService);
    }

    @Bean
    public ProcessorEngine processorEngine(ScriptInvocationService scriptInvocationService,
                                           ConfigValueApplicationService configValueApplicationService) {
        return new DefaultProcessorEngine(scriptInvocationService, configValueApplicationService);
    }

    @Bean
    public ProcessorApplicationService processorApplicationService(ProcessorEngine processorEngine) {
        return new ProcessorApplicationService(processorEngine);
    }

    @Bean
    public ExecutionPresetApplicationService executionPresetApplicationService(ExecutionPresetRepository executionPresetRepository) {
        return new ExecutionPresetApplicationService(executionPresetRepository);
    }
}
