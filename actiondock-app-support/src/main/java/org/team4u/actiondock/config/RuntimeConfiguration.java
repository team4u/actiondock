package org.team4u.actiondock.config;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.actiondock.ai.agentscope.AgentScopeAiProviderClient;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiAgentRunRepository;
import org.team4u.actiondock.ai.api.AiAgentStepRepository;
import org.team4u.actiondock.ai.api.AiCallLogRepository;
import org.team4u.actiondock.ai.api.AiGateway;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiProviderClient;
import org.team4u.actiondock.ai.api.AiSecretResolver;
import org.team4u.actiondock.ai.api.AiTool;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.ai.core.AiAgentProfileService;
import org.team4u.actiondock.ai.core.AiAgentRuntimeImpl;
import org.team4u.actiondock.ai.core.AiGatewayImpl;
import org.team4u.actiondock.ai.core.AiModelProfileService;
import org.team4u.actiondock.ai.core.AiToolRegistryImpl;
import org.team4u.actiondock.ai.core.AiToolsetService;
import org.team4u.actiondock.ai.plugin.ActionDockAiSystemPlugin;
import org.team4u.actiondock.ai.tool.ActionDockAiTools;
import org.team4u.actiondock.application.ApiAccessTokenApplicationService;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.ExecutionPresetApplicationService;
import org.team4u.actiondock.application.ScheduleApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.application.ScriptInvocationService;
import org.team4u.actiondock.configvalue.ConfigValueUsageAnalysisService;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.ApiAccessTokenRepository;
import org.team4u.actiondock.domain.port.ExecutionPresetRepository;
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
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.repository.HttpPluginArtifactResolver;
import org.team4u.actiondock.repository.LocalPluginArtifactResolver;
import org.team4u.actiondock.repository.PluginArtifactResolver;
import org.team4u.actiondock.repository.PluginArtifactResolverRegistry;
import org.team4u.actiondock.repository.RepositoryCatalogService;
import org.team4u.actiondock.script.GroovyScriptEngine;
import org.team4u.actiondock.script.PythonScriptEngine;
import org.team4u.actiondock.script.RoutingScriptEngine;

import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.List;

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
    public ApiAccessTokenApplicationService apiAccessTokenApplicationService(ApiAccessTokenRepository apiAccessTokenRepository) {
        return new ApiAccessTokenApplicationService(apiAccessTokenRepository);
    }

    @Bean
    public PluginRuntimeService pluginRuntimeService(JsonCodec jsonCodec,
                                                     PluginRegistryRepository pluginRegistryRepository,
                                                     ConfigValueApplicationService configValueApplicationService,
                                                     AppProperties properties,
                                                     List<ActionDockPlugin> systemPlugins) {
        return new PluginRuntimeService(jsonCodec, pluginRegistryRepository, properties.getPlugins(), configValueApplicationService, systemPlugins);
    }

    @Bean
    public AiSecretResolver aiSecretResolver(ConfigValueApplicationService configValueApplicationService) {
        return key -> key == null || key.isBlank() ? null : configValueApplicationService.snapshot().get(key);
    }

    @Bean
    public AiProviderClient aiProviderClient(AiSecretResolver secretResolver) {
        return new AgentScopeAiProviderClient(secretResolver);
    }

    @Bean
    public AiModelProfileService aiModelProfileService(AiModelProfileRepository repository) {
        return new AiModelProfileService(repository);
    }

    @Bean
    public AiAgentProfileService aiAgentProfileService(AiAgentProfileRepository repository,
                                                       AiModelProfileRepository modelProfileRepository) {
        return new AiAgentProfileService(repository, modelProfileRepository);
    }

    @Bean
    public AiToolsetService aiToolsetService(AiToolsetRepository repository) {
        return new AiToolsetService(repository);
    }

    @Bean
    public AiToolRegistryImpl aiToolRegistry(AiToolsetRepository toolsetRepository, ObjectProvider<List<AiTool>> toolsProvider) {
        List<AiTool> tools = toolsProvider.getIfAvailable(List::of);
        return new AiToolRegistryImpl(toolsetRepository, tools);
    }

    @Bean
    public List<AiTool> actionDockAiTools(ScriptRepository scriptRepository,
                                          ExecutionRepository executionRepository,
                                          PluginRegistryRepository pluginRegistryRepository) {
        return ActionDockAiTools.create(scriptRepository, executionRepository, pluginRegistryRepository);
    }

    @Bean
    public AiGateway aiGateway(AiModelProfileService modelProfileService,
                               AiProviderClient providerClient,
                               AiCallLogRepository callLogRepository) {
        return new AiGatewayImpl(modelProfileService, providerClient, callLogRepository);
    }

    @Bean
    public AiAgentRuntimeImpl aiAgentRuntime(AiAgentProfileService agentProfileService,
                                             AiModelProfileRepository modelProfileRepository,
                                             AiAgentRunRepository runRepository,
                                             AiAgentStepRepository stepRepository,
                                             AiProviderClient providerClient,
                                             AiToolRegistryImpl toolRegistry) {
        return new AiAgentRuntimeImpl(agentProfileService, modelProfileRepository, runRepository, stepRepository, providerClient, toolRegistry);
    }

    @Bean
    public ActionDockPlugin actionDockAiSystemPlugin(AiGateway aiGateway, AiAgentRuntimeImpl aiAgentRuntime) {
        return new ActionDockAiSystemPlugin(aiGateway, aiAgentRuntime);
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
    public ExecutionPresetApplicationService executionPresetApplicationService(ExecutionPresetRepository executionPresetRepository) {
        return new ExecutionPresetApplicationService(executionPresetRepository);
    }

    @Bean
    public PluginArtifactResolver localPluginArtifactResolver() {
        return new LocalPluginArtifactResolver();
    }

    @Bean
    public PluginArtifactResolver httpPluginArtifactResolver() {
        return new HttpPluginArtifactResolver();
    }

    @Bean
    public PluginArtifactResolverRegistry pluginArtifactResolverRegistry(List<PluginArtifactResolver> resolvers) {
        return new PluginArtifactResolverRegistry(resolvers);
    }

    @Bean
    public RepositoryCatalogService repositoryCatalogService(RepositoryDefinitionRepository repositoryDefinitionRepository,
                                                             RepositoryToolInstallationRepository repositoryToolInstallationRepository,
                                                             ScriptRepository scriptRepository,
                                                             ScriptScheduleRepository scriptScheduleRepository,
                                                             ConfigValueRepository configValueRepository,
                                                             ScriptApplicationService scriptApplicationService,
                                                             ConfigValueApplicationService configValueApplicationService,
                                                             PluginRuntimeService pluginRuntimeService,
                                                             JsonCodec jsonCodec,
                                                             AppProperties properties,
                                                             PluginArtifactResolverRegistry pluginArtifactResolverRegistry) {
        return new RepositoryCatalogService(
                repositoryDefinitionRepository,
                repositoryToolInstallationRepository,
                scriptRepository,
                scriptScheduleRepository,
                configValueRepository,
                scriptApplicationService,
                configValueApplicationService,
                pluginRuntimeService,
                jsonCodec,
                properties,
                pluginArtifactResolverRegistry
        );
    }

    @Bean
    public ConfigValueUsageAnalysisService configValueUsageAnalysisService(ConfigValueRepository configValueRepository,
                                                                          ScriptRepository scriptRepository,
                                                                          ScriptScheduleRepository scriptScheduleRepository,
                                                                          PluginRegistryRepository pluginRegistryRepository,
                                                                          PluginRuntimeService pluginRuntimeService,
                                                                          RepositoryCatalogService repositoryCatalogService) {
        return new ConfigValueUsageAnalysisService(
                configValueRepository,
                scriptRepository,
                scriptScheduleRepository,
                pluginRegistryRepository,
                pluginId -> pluginRuntimeService.getConfig(pluginId).getConfig(),
                repositoryCatalogService::listRepositories,
                repositoryCatalogService::listRepositoryTools,
                repositoryCatalogService::listAllRepositoryTools,
                repositoryCatalogService::getRepositoryTool
        );
    }
}
