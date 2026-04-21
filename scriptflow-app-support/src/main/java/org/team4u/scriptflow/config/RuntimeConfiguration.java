package org.team4u.scriptflow.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.scriptflow.application.ExecutionApplicationService;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.domain.port.ExecutionRepository;
import org.team4u.scriptflow.domain.port.ScriptEngine;
import org.team4u.scriptflow.domain.port.ScriptRepository;

import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(AppProperties.class)
public class RuntimeConfiguration {
    @Bean
    public Executor executionExecutor(AppProperties properties) {
        return Executors.newFixedThreadPool(properties.getExecution().getAsyncPoolSize());
    }

    @Bean
    public ScriptApplicationService scriptApplicationService(ScriptRepository scriptRepository, ScriptEngine scriptEngine) {
        return new ScriptApplicationService(scriptRepository, scriptEngine);
    }

    @Bean
    public ExecutionApplicationService executionApplicationService(ScriptRepository scriptRepository,
                                                                   ExecutionRepository executionRepository,
                                                                   ScriptEngine scriptEngine,
                                                                   Executor executor) {
        return new ExecutionApplicationService(scriptRepository, executionRepository, scriptEngine, executor);
    }
}
