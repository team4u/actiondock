package org.team4u.actiondock.config;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.actiondock.ai.agentscope.AgentScopeAiProviderClient;
import org.team4u.actiondock.ai.agentscope.AgentScopeBuiltinAiTools;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiAgentRunRepository;
import org.team4u.actiondock.ai.api.AiAgentSkill;
import org.team4u.actiondock.ai.api.AiAgentSkillRegistry;
import org.team4u.actiondock.ai.api.AiAgentStepRepository;
import org.team4u.actiondock.ai.api.AiCallLogRepository;
import org.team4u.actiondock.ai.api.AiGateway;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiProviderClient;
import org.team4u.actiondock.ai.api.AiSecretResolver;
import org.team4u.actiondock.ai.api.AiTool;
import org.team4u.actiondock.ai.api.AiToolProvider;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.ai.core.AiAgentProfileService;
import org.team4u.actiondock.ai.core.AiAgentRuntimeImpl;
import org.team4u.actiondock.ai.core.AiGatewayImpl;
import org.team4u.actiondock.ai.core.AiModelProfileService;
import org.team4u.actiondock.ai.core.AiToolRegistryImpl;
import org.team4u.actiondock.ai.core.AiToolsetService;
import org.team4u.actiondock.ai.plugin.ActionDockAiSystemPlugin;
import org.team4u.actiondock.ai.tool.ActionDockAiTools;
import org.team4u.actiondock.ai.tool.ActionDockDynamicAiToolProvider;
import org.team4u.actiondock.application.ApiAccessTokenApplicationService;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.ExecutionPresetApplicationService;
import org.team4u.actiondock.application.EventIngestionApplicationService;
import org.team4u.actiondock.application.EventRecordApplicationService;
import org.team4u.actiondock.application.EventSourceApplicationService;
import org.team4u.actiondock.application.EventTriggerApplicationService;
import org.team4u.actiondock.application.ProcessorApplicationService;
import org.team4u.actiondock.application.ScheduleApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.application.ScriptInvocationService;
import org.team4u.actiondock.application.SharedStateApplicationService;
import org.team4u.actiondock.configvalue.ConfigValueUsageAnalysisService;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.ApiAccessTokenRepository;
import org.team4u.actiondock.domain.port.EventDispatchRepository;
import org.team4u.actiondock.domain.port.EventRecordRepository;
import org.team4u.actiondock.domain.port.EventSourceRepository;
import org.team4u.actiondock.domain.port.EventTriggerRepository;
import org.team4u.actiondock.domain.port.ExecutionPresetRepository;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ManagedSkillRepository;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.domain.port.ProcessorEngine;
import org.team4u.actiondock.domain.port.RepositoryDefinitionRepository;
import org.team4u.actiondock.domain.port.CapabilityPackageInstallationRepository;
import org.team4u.actiondock.domain.port.ScheduleExpressionValidator;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.domain.port.RepositoryToolInstallationRepository;
import org.team4u.actiondock.domain.port.SkillInstallationRepository;
import org.team4u.actiondock.domain.port.SkillTargetRepository;
import org.team4u.actiondock.domain.port.SharedStateRepository;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.processor.DefaultProcessorEngine;
import org.team4u.actiondock.repository.HttpPluginArtifactResolver;
import org.team4u.actiondock.repository.LocalPluginArtifactResolver;
import org.team4u.actiondock.repository.PluginArtifactResolver;
import org.team4u.actiondock.repository.PluginArtifactResolverRegistry;
import org.team4u.actiondock.repository.RepositoryCatalogService;
import org.team4u.actiondock.repository.RepositoryCapabilityPackageService;
import org.team4u.actiondock.repository.RepositoryPluginService;
import org.team4u.actiondock.repository.RepositoryToolService;
import org.team4u.actiondock.script.GroovyScriptEngine;
import org.team4u.actiondock.script.PythonScriptEngine;
import org.team4u.actiondock.script.RoutingScriptEngine;
import org.team4u.actiondock.skill.GithubSkillCollectionService;
import org.team4u.actiondock.skill.SkillService;
import org.team4u.actiondock.skill.SkillTargetService;

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
    public PluginRuntimeService pluginRuntimeService(JsonCodec jsonCodec,
                                                     PluginRegistryRepository pluginRegistryRepository,
                                                     ScriptRepository scriptRepository,
                                                     ConfigValueApplicationService configValueApplicationService,
                                                     AppProperties properties,
                                                     List<ActionDockPlugin> systemPlugins) {
        return new PluginRuntimeService(jsonCodec, pluginRegistryRepository, scriptRepository, properties.getPlugins(), configValueApplicationService, systemPlugins);
    }

    @Bean
    public AiSecretResolver aiSecretResolver(ConfigValueApplicationService configValueApplicationService) {
        return key -> key == null || key.isBlank() ? null : configValueApplicationService.snapshot().get(key);
    }

    @Bean
    public AiAgentSkillRegistry aiAgentSkillRegistry(SkillService skillService) {
        return skillId -> {
            SkillService.RuntimeSkill skill = skillService.requireRuntimeSkill(skillId);
            return new AiAgentSkill(
                    skill.skillId(),
                    skill.displayName(),
                    skill.description(),
                    skill.skillContent(),
                    skill.resources(),
                    skill.source()
            );
        };
    }

    @Bean
    public AiProviderClient aiProviderClient(AiSecretResolver secretResolver, AiAgentSkillRegistry skillRegistry) {
        return new AgentScopeAiProviderClient(secretResolver, skillRegistry);
    }

    @Bean
    public AiModelProfileService aiModelProfileService(AiModelProfileRepository repository,
                                                       AiAgentProfileRepository agentProfileRepository) {
        return new AiModelProfileService(repository, agentProfileRepository);
    }

    @Bean
    public AiAgentProfileService aiAgentProfileService(AiAgentProfileRepository repository,
                                                       AiModelProfileRepository modelProfileRepository,
                                                       AiToolsetRepository toolsetRepository,
                                                       AiToolRegistryImpl toolRegistry,
                                                       AiAgentSkillRegistry skillRegistry) {
        return new AiAgentProfileService(repository, modelProfileRepository, toolsetRepository, toolRegistry, skillRegistry);
    }

    @Bean
    public AiToolsetService aiToolsetService(AiToolsetRepository repository,
                                             AiAgentProfileRepository agentProfileRepository,
                                             AiToolRegistryImpl toolRegistry) {
        return new AiToolsetService(repository, agentProfileRepository, toolRegistry);
    }

    @Bean
    public AiToolRegistryImpl aiToolRegistry(AiToolsetRepository toolsetRepository,
                                             ObjectProvider<List<AiTool>> toolsProvider,
                                             ObjectProvider<List<AiToolProvider>> toolProviders) {
        List<AiTool> tools = toolsProvider.getIfAvailable(List::of);
        List<AiToolProvider> providers = toolProviders.getIfAvailable(List::of);
        return new AiToolRegistryImpl(toolsetRepository, tools, providers);
    }

    @Bean
    public List<AiTool> actionDockAiTools(ScriptRepository scriptRepository,
                                          ExecutionRepository executionRepository,
                                          PluginRegistryRepository pluginRegistryRepository,
                                          AiSecretResolver secretResolver) {
        java.util.ArrayList<AiTool> tools = new java.util.ArrayList<>(ActionDockAiTools.create(scriptRepository, executionRepository, pluginRegistryRepository));
        tools.addAll(AgentScopeBuiltinAiTools.create(secretResolver));
        return tools;
    }

    @Bean
    public AiGateway aiGateway(AiModelProfileService modelProfileService,
                               AiProviderClient providerClient,
                               AiCallLogRepository callLogRepository) {
        return new AiGatewayImpl(modelProfileService, providerClient, callLogRepository);
    }

    @Bean
    public AiToolProvider actionDockDynamicAiToolProvider(ScriptRepository scriptRepository,
                                                          AiAgentProfileRepository agentProfileRepository,
                                                          ObjectProvider<ExecutionApplicationService> executionApplicationServiceProvider,
                                                          ObjectProvider<AiAgentRuntimeImpl> aiAgentRuntimeProvider) {
        return new ActionDockDynamicAiToolProvider(
                scriptRepository,
                agentProfileRepository,
                executionApplicationServiceProvider::getObject,
                aiAgentRuntimeProvider::getObject
        );
    }

    @Bean
    public AiAgentRuntimeImpl aiAgentRuntime(AiAgentProfileService agentProfileService,
                                             AiModelProfileRepository modelProfileRepository,
                                             AiAgentRunRepository runRepository,
                                             AiAgentStepRepository stepRepository,
                                             AiProviderClient providerClient,
                                             AiToolRegistryImpl toolRegistry,
                                             Executor executionExecutor) {
        return new AiAgentRuntimeImpl(agentProfileService, modelProfileRepository, runRepository, stepRepository, providerClient, toolRegistry, executionExecutor);
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
    public EventSourceApplicationService eventSourceApplicationService(EventSourceRepository eventSourceRepository,
                                                                       ProcessorEngine processorEngine) {
        return new EventSourceApplicationService(eventSourceRepository, processorEngine);
    }

    @Bean
    public EventTriggerApplicationService eventTriggerApplicationService(EventTriggerRepository eventTriggerRepository,
                                                                         EventSourceRepository eventSourceRepository,
                                                                         EventDispatchRepository eventDispatchRepository,
                                                                         ScriptRepository scriptRepository,
                                                                         ProcessorEngine processorEngine,
                                                                         ExecutionApplicationService executionApplicationService) {
        return new EventTriggerApplicationService(
                eventTriggerRepository,
                eventSourceRepository,
                eventDispatchRepository,
                scriptRepository,
                processorEngine,
                executionApplicationService
        );
    }

    @Bean
    public EventIngestionApplicationService eventIngestionApplicationService(EventSourceApplicationService eventSourceApplicationService,
                                                                             EventTriggerApplicationService eventTriggerApplicationService,
                                                                             EventRecordRepository eventRecordRepository,
                                                                             ConfigValueApplicationService configValueApplicationService,
                                                                             JsonCodec jsonCodec) {
        return new EventIngestionApplicationService(
                eventSourceApplicationService,
                eventTriggerApplicationService,
                eventRecordRepository,
                configValueApplicationService,
                jsonCodec
        );
    }

    @Bean
    public EventRecordApplicationService eventRecordApplicationService(EventRecordRepository eventRecordRepository,
                                                                       EventDispatchRepository eventDispatchRepository) {
        return new EventRecordApplicationService(eventRecordRepository, eventDispatchRepository);
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
                                                             CapabilityPackageInstallationRepository capabilityPackageInstallationRepository,
                                                             ScriptRepository scriptRepository,
                                                             ScriptScheduleRepository scriptScheduleRepository,
                                                             ExecutionPresetRepository executionPresetRepository,
                                                             ConfigValueRepository configValueRepository,
                                                             AiModelProfileRepository aiModelProfileRepository,
                                                             AiAgentProfileRepository aiAgentProfileRepository,
                                                             AiToolsetRepository aiToolsetRepository,
                                                             ScriptApplicationService scriptApplicationService,
                                                             ConfigValueApplicationService configValueApplicationService,
                                                             PluginRuntimeService pluginRuntimeService,
                                                             JsonCodec jsonCodec,
                                                             AppProperties properties,
                                                             PluginArtifactResolverRegistry pluginArtifactResolverRegistry) {
        return new RepositoryCatalogService(
                repositoryDefinitionRepository,
                repositoryToolInstallationRepository,
                capabilityPackageInstallationRepository,
                scriptRepository,
                scriptScheduleRepository,
                executionPresetRepository,
                configValueRepository,
                aiModelProfileRepository,
                aiAgentProfileRepository,
                aiToolsetRepository,
                scriptApplicationService,
                configValueApplicationService,
                pluginRuntimeService,
                jsonCodec,
                properties,
                pluginArtifactResolverRegistry
        );
    }

    @Bean
    public RepositoryPluginService repositoryPluginService(RepositoryCatalogService repositoryCatalogService,
                                                            PluginRuntimeService pluginRuntimeService,
                                                            ScriptRepository scriptRepository,
                                                            PluginArtifactResolverRegistry pluginArtifactResolverRegistry) {
        return new RepositoryPluginService(repositoryCatalogService, pluginRuntimeService, scriptRepository, pluginArtifactResolverRegistry);
    }

    @Bean
    public RepositoryToolService repositoryToolService(RepositoryCatalogService repositoryCatalogService,
                                                        RepositoryPluginService repositoryPluginService,
                                                        ScriptApplicationService scriptApplicationService,
                                                        ScriptRepository scriptRepository,
                                                        ScriptScheduleRepository scriptScheduleRepository,
                                                        RepositoryToolInstallationRepository repositoryToolInstallationRepository,
                                                        ConfigValueRepository configValueRepository,
                                                        PluginRuntimeService pluginRuntimeService) {
        return new RepositoryToolService(
                repositoryCatalogService,
                repositoryPluginService,
                scriptApplicationService,
                scriptRepository,
                scriptScheduleRepository,
                repositoryToolInstallationRepository,
                configValueRepository,
                pluginRuntimeService
        );
    }

    @Bean
    public RepositoryCapabilityPackageService repositoryCapabilityPackageService(
            RepositoryCatalogService repositoryCatalogService,
            CapabilityPackageInstallationRepository capabilityPackageInstallationRepository,
            ExecutionPresetRepository executionPresetRepository) {
        return new RepositoryCapabilityPackageService(
                repositoryCatalogService,
                capabilityPackageInstallationRepository,
                executionPresetRepository
        );
    }

    @Bean
    public SkillService skillService(SkillTargetRepository skillTargetRepository,
                                     ManagedSkillRepository managedSkillRepository,
                                     SkillInstallationRepository skillInstallationRepository,
                                     JsonCodec jsonCodec,
                                     AppProperties properties) {
        return new SkillService(skillTargetRepository, managedSkillRepository, skillInstallationRepository, jsonCodec, properties);
    }

    @Bean
    public SkillTargetService skillTargetService(SkillTargetRepository skillTargetRepository,
                                                  SkillInstallationRepository skillInstallationRepository,
                                                  SkillService skillService) {
        return new SkillTargetService(skillTargetRepository, skillInstallationRepository, skillService);
    }

    @Bean
    public GithubSkillCollectionService githubSkillCollectionService(SkillService skillService, JsonCodec jsonCodec) {
        return new GithubSkillCollectionService(skillService, jsonCodec);
    }

    @Bean
    public ConfigValueUsageAnalysisService configValueUsageAnalysisService(ConfigValueRepository configValueRepository,
                                                                          ScriptRepository scriptRepository,
                                                                          ScriptScheduleRepository scriptScheduleRepository,
                                                                          PluginRegistryRepository pluginRegistryRepository,
                                                                          PluginRuntimeService pluginRuntimeService,
                                                                          RepositoryCatalogService repositoryCatalogService,
                                                                          AiModelProfileRepository aiModelProfileRepository) {
        return new ConfigValueUsageAnalysisService(
                configValueRepository,
                scriptRepository,
                scriptScheduleRepository,
                pluginRegistryRepository,
                pluginId -> pluginRuntimeService.getConfig(pluginId).getConfig(),
                repositoryCatalogService::listRepositories,
                repositoryCatalogService::listRepositoryTools,
                repositoryCatalogService::listAllRepositoryTools,
                repositoryCatalogService::getRepositoryTool,
                aiModelProfileRepository::findAll
        );
    }
}
