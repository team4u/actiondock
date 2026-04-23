package org.team4u.scriptflow.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.scriptflow.application.ExecutionApplicationService;
import org.team4u.scriptflow.application.ScheduleApplicationService;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.domain.port.ExecutionRepository;
import org.team4u.scriptflow.domain.port.JsonCodec;
import org.team4u.scriptflow.domain.port.PluginRegistryRepository;
import org.team4u.scriptflow.domain.port.ScheduleExpressionValidator;
import org.team4u.scriptflow.domain.port.ScriptEngine;
import org.team4u.scriptflow.domain.port.ScriptRepository;
import org.team4u.scriptflow.domain.port.ScriptScheduleRepository;
import org.team4u.scriptflow.plugin.PluginRuntimeService;
import org.team4u.scriptflow.script.GroovyScriptEngine;
import org.team4u.scriptflow.script.PythonScriptEngine;
import org.team4u.scriptflow.script.RoutingScriptEngine;

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
    public PluginRuntimeService pluginRuntimeService(JsonCodec jsonCodec,
                                                     PluginRegistryRepository pluginRegistryRepository,
                                                     AppProperties properties) {
        return new PluginRuntimeService(jsonCodec, pluginRegistryRepository, properties.getPlugins());
    }

    @Bean
    public ScriptEngine scriptEngine(JsonCodec jsonCodec, AppProperties properties, PluginRuntimeService pluginRuntimeService) {
        return new RoutingScriptEngine(
                new GroovyScriptEngine(properties.getExecution().getGroovy(), pluginRuntimeService),
                new PythonScriptEngine(jsonCodec, properties.getExecution().getPython())
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
                                                                 ScheduleExpressionValidator scheduleExpressionValidator) {
        return new ScheduleApplicationService(scriptScheduleRepository, scriptRepository, scheduleExpressionValidator);
    }

    @Bean
    public ExecutionApplicationService executionApplicationService(ScriptRepository scriptRepository,
                                                                   ExecutionRepository executionRepository,
                                                                   ScriptEngine scriptEngine,
                                                                   Executor executor) {
        return new ExecutionApplicationService(scriptRepository, executionRepository, scriptEngine, executor);
    }
}
