package org.team4u.actiondock.config;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.ScheduleApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.application.ScriptInvocationService;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.domain.port.RepositoryDefinitionRepository;
import org.team4u.actiondock.domain.port.ScheduleExpressionValidator;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.domain.port.RepositoryToolInstallationRepository;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.repository.RepositoryCatalogService;
import org.team4u.actiondock.script.GroovyScriptEngine;
import org.team4u.actiondock.script.PythonScriptEngine;
import org.team4u.actiondock.script.RoutingScriptEngine;

import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/**
 * 运行时配置，注册应用服务、脚本引擎和插件运行时等核心 Bean。
 *
 * @author jay.wu
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(AppProperties.class)
public class RuntimeConfiguration {
    @Bean
    public Executor executionExecutor(AppProperties properties) {
        return Executors.newFixedThreadPool(properties.getExecution().getAsyncPoolSize());
    }

    @Bean
    public ConfigValueApplicationService configValueApplicationService(ConfigValueRepository configValueRepository) {
        return new ConfigValueApplicationService(configValueRepository);
    }

    @Bean
    public PluginRuntimeService pluginRuntimeService(JsonCodec jsonCodec,
                                                     PluginRegistryRepository pluginRegistryRepository,
                                                     ConfigValueApplicationService configValueApplicationService,
                                                     AppProperties properties) {
        return new PluginRuntimeService(jsonCodec, pluginRegistryRepository, properties.getPlugins(), configValueApplicationService);
    }

    @Bean
    public ScriptInvocationService scriptInvocationService(ScriptRepository scriptRepository,
                                                           ObjectProvider<ScriptEngine> scriptEngineProvider) {
        return new ScriptInvocationService(scriptRepository, scriptEngineProvider::getObject);
    }

    @Bean
    public ScriptEngine scriptEngine(JsonCodec jsonCodec,
                                     AppProperties properties,
                                     PluginRuntimeService pluginRuntimeService,
                                     ScriptInvocationService scriptInvocationService) {
        return new RoutingScriptEngine(
                new GroovyScriptEngine(properties.getExecution().getGroovy(), pluginRuntimeService, scriptInvocationService),
                new PythonScriptEngine(jsonCodec, properties.getExecution().getPython(), scriptInvocationService)
        );
    }

    @Bean
    @ConditionalOnMissingBean(ScheduleExpressionValidator.class)
    public ScheduleExpressionValidator defaultScheduleExpressionValidator() {
        return expression -> {
        };
    }

    @Bean
    public ScriptApplicationService scriptApplicationService(ScriptRepository scriptRepository,
                                                             ScriptEngine scriptEngine,
                                                             ScriptScheduleRepository scriptScheduleRepository) {
        return new ScriptApplicationService(scriptRepository, scriptEngine, scriptScheduleRepository);
    }

    @Bean
    public ScheduleApplicationService scheduleApplicationService(ScriptScheduleRepository scriptScheduleRepository,
                                                                 ScriptRepository scriptRepository,
                                                                 ScheduleExpressionValidator scheduleExpressionValidator,
                                                                 ConfigValueApplicationService configValueApplicationService) {
        return new ScheduleApplicationService(scriptScheduleRepository, scriptRepository, scheduleExpressionValidator, configValueApplicationService);
    }

    @Bean
    public ExecutionApplicationService executionApplicationService(ScriptRepository scriptRepository,
                                                                   ExecutionRepository executionRepository,
                                                                   ScriptEngine scriptEngine,
                                                                   Executor executor,
                                                                   ConfigValueApplicationService configValueApplicationService) {
        return new ExecutionApplicationService(scriptRepository, executionRepository, scriptEngine, executor, configValueApplicationService);
    }

    @Bean
    public RepositoryCatalogService repositoryCatalogService(RepositoryDefinitionRepository repositoryDefinitionRepository,
                                                             RepositoryToolInstallationRepository repositoryToolInstallationRepository,
                                                             ScriptRepository scriptRepository,
                                                             ScriptScheduleRepository scriptScheduleRepository,
                                                             ConfigValueRepository configValueRepository,
                                                             ScriptApplicationService scriptApplicationService,
                                                             ConfigValueApplicationService configValueApplicationService,
                                                             JsonCodec jsonCodec,
                                                             AppProperties properties) {
        return new RepositoryCatalogService(
                repositoryDefinitionRepository,
                repositoryToolInstallationRepository,
                scriptRepository,
                scriptScheduleRepository,
                configValueRepository,
                scriptApplicationService,
                configValueApplicationService,
                jsonCodec,
                properties
        );
    }
}
