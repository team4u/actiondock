package org.team4u.actiondock.config;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.application.ScriptInvocationService;
import org.team4u.actiondock.application.SharedStateApplicationService;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.script.GroovyScriptEngine;
import org.team4u.actiondock.script.PythonScriptEngine;
import org.team4u.actiondock.script.RoutingScriptEngine;

import java.util.concurrent.Executor;

/**
 * 脚本引擎配置，注册脚本调用服务、脚本引擎和脚本应用服务等 Bean。
 *
 * @author jay.wu
 */
@Configuration(proxyBeanMethods = false)
public class ScriptConfiguration {

    @Bean
    public ScriptInvocationService scriptInvocationService(ScriptRepository scriptRepository,
                                                           ObjectProvider<ScriptEngine> scriptEngineProvider) {
        return new ScriptInvocationService(scriptRepository, scriptEngineProvider::getObject);
    }

    @Bean
    public ScriptEngine scriptEngine(JsonCodec jsonCodec,
                                     AppProperties properties,
                                     PluginRuntimeService pluginRuntimeService,
                                     ScriptInvocationService scriptInvocationService,
                                     SharedStateApplicationService sharedStateApplicationService,
                                     @Qualifier("executionExecutor") Executor executionExecutor) {
        return new RoutingScriptEngine(
                new GroovyScriptEngine(properties.getExecution().getGroovy(), pluginRuntimeService, scriptInvocationService, sharedStateApplicationService),
                new PythonScriptEngine(
                        jsonCodec,
                        properties.getExecution().getPython(),
                        pluginRuntimeService,
                        scriptInvocationService,
                        sharedStateApplicationService,
                        executionExecutor
                )
        );
    }

    @Bean
    public ScriptApplicationService scriptApplicationService(ScriptRepository scriptRepository,
                                                             ScriptEngine scriptEngine,
                                                             ScriptScheduleRepository scriptScheduleRepository,
                                                             RepositoryLocalAssetRepository repositoryLocalAssetRepository) {
        return new TransactionalScriptApplicationService(
                scriptRepository,
                scriptEngine,
                scriptScheduleRepository,
                repositoryLocalAssetRepository
        );
    }
}
