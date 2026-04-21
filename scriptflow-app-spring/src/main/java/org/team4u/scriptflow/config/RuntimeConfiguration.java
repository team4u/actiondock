package org.team4u.scriptflow.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.scriptflow.application.ExecutionApplicationService;
import org.team4u.scriptflow.application.PageDefinitionApplicationService;
import org.team4u.scriptflow.application.PageRuntimeApplicationService;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.domain.port.ExecutionRepository;
import org.team4u.scriptflow.domain.port.PageRepository;
import org.team4u.scriptflow.domain.port.PageSchemaBuilder;
import org.team4u.scriptflow.domain.port.PageSchemaRenderer;
import org.team4u.scriptflow.domain.port.ScriptEngine;
import org.team4u.scriptflow.domain.port.ScriptRepository;
import org.team4u.scriptflow.pagebuilder.DefaultPageSchemaBuilder;
import org.team4u.scriptflow.renderer.amis.AmisPageRenderer;

import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

@Configuration
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

    @Bean
    public PageDefinitionApplicationService pageDefinitionApplicationService(PageRepository pageRepository,
                                                                            ScriptRepository scriptRepository) {
        return new PageDefinitionApplicationService(pageRepository, scriptRepository);
    }

    @Bean
    public PageSchemaBuilder pageSchemaBuilder() {
        return new DefaultPageSchemaBuilder();
    }

    @Bean
    public PageSchemaRenderer pageSchemaRenderer() {
        return new AmisPageRenderer();
    }

    @Bean
    public PageRuntimeApplicationService pageRuntimeApplicationService(PageRepository pageRepository,
                                                                      ScriptRepository scriptRepository,
                                                                      ExecutionApplicationService executionApplicationService,
                                                                      PageSchemaBuilder pageSchemaBuilder,
                                                                      PageSchemaRenderer pageSchemaRenderer) {
        return new PageRuntimeApplicationService(pageRepository, scriptRepository, executionApplicationService, pageSchemaBuilder, pageSchemaRenderer);
    }
}
