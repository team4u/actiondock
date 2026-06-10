package org.team4u.actiondock.config;

import org.team4u.actiondock.common.NormalizeUtils;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.actiondock.ai.agentscope.AgentScopeAiProviderClient;
import org.team4u.actiondock.ai.agentscope.AgentScopeBuiltinAiTools;
import org.team4u.actiondock.ai.api.*;
import org.team4u.actiondock.ai.core.*;
import org.team4u.actiondock.ai.plugin.ActionDockAiSystemPlugin;
import org.team4u.actiondock.ai.tool.ActionDockAiTools;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.ai.tool.ActionDockDynamicAiToolProvider;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.skill.SkillService;

import static org.team4u.actiondock.skill.SkillTypes.*;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;

/**
 * AI 相关配置，注册 AI 模型、Agent、工具集、网关等核心 Bean。
 *
 * @author jay.wu
 */
@Configuration(proxyBeanMethods = false)
public class AiConfiguration {

    @Bean
    public AiSecretResolver aiSecretResolver(ConfigValueApplicationService configValueApplicationService) {
        return key -> NormalizeUtils.isBlank(key) ? null : configValueApplicationService.snapshot().get(key);
    }

    @Bean
    public AiAgentSkillRegistry aiAgentSkillRegistry(SkillService skillService) {
        return skillId -> {
            RuntimeSkill skill = skillService.requireRuntimeSkill(skillId);
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
        ArrayList<AiTool> tools = new ArrayList<>(ActionDockAiTools.create(scriptRepository, executionRepository, pluginRegistryRepository));
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
                                             @Qualifier("executionExecutor") Executor executionExecutor) {
        return new AiAgentRuntimeImpl(agentProfileService, modelProfileRepository, runRepository, stepRepository, providerClient, toolRegistry, executionExecutor);
    }

    @Bean
    public ActionDockPlugin actionDockAiSystemPlugin(AiGateway aiGateway, AiAgentRuntimeImpl aiAgentRuntime) {
        return new ActionDockAiSystemPlugin(aiGateway, aiAgentRuntime);
    }
}
