package org.team4u.actiondock.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.configvalue.ConfigValueUsageAnalysisService;
import org.team4u.actiondock.domain.port.*;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.domain.port.WebhookRepository;
import org.team4u.actiondock.repository.*;

import java.util.List;

/**
 * 仓库相关配置，注册仓库目录、插件、工具、能力包等 Bean。
 *
 * @author jay.wu
 */
@Configuration(proxyBeanMethods = false)
public class RepositoryConfiguration {

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
                                                             CapabilityPackageInstallationRepository capabilityPackageInstallationRepository,
                                                             ManagedSkillRepository managedSkillRepository,
                                                             ScriptRepository scriptRepository,
                                                             ScriptScheduleRepository scriptScheduleRepository,
                                                             ExecutionPresetRepository executionPresetRepository,
                                                             ConfigValueRepository configValueRepository,
                                                             WebhookRepository webhookRepository,
                                                             RepositoryLocalAssetRepository repositoryLocalAssetRepository,
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
                new RepositoryCatalogService.Repositories(
                        repositoryDefinitionRepository,
                        capabilityPackageInstallationRepository,
                        managedSkillRepository,
                        scriptRepository,
                        scriptScheduleRepository,
                        executionPresetRepository,
                        configValueRepository,
                        webhookRepository,
                        repositoryLocalAssetRepository,
                        aiModelProfileRepository,
                        aiAgentProfileRepository,
                        aiToolsetRepository
                ),
                new RepositoryCatalogService.ApplicationServices(
                        scriptApplicationService,
                        configValueApplicationService,
                        pluginRuntimeService
                ),
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
    public RepositoryScriptService repositoryToolService(RepositoryCatalogService repositoryCatalogService,
                                                        RepositoryPluginService repositoryPluginService) {
        return new RepositoryScriptService(
                repositoryCatalogService,
                repositoryPluginService,
                repositoryCatalogService.getRepos(),
                repositoryCatalogService.getServices(),
                repositoryCatalogService.getConfigTemplateSyncService()
        );
    }

    @Bean
    public RepositoryCapabilityPackageService repositoryCapabilityPackageService(
            RepositoryCatalogService repositoryCatalogService,
            CapabilityPackageInstallationRepository capabilityPackageInstallationRepository,
            ExecutionPresetRepository executionPresetRepository,
            AiModelProfileRepository aiModelProfileRepository,
            AiAgentProfileRepository aiAgentProfileRepository,
            AiToolsetRepository aiToolsetRepository,
            ScriptRepository scriptRepository,
            ScriptScheduleRepository scriptScheduleRepository,
            ConfigValueRepository configValueRepository,
            WebhookRepository webhookRepository,
            RepositoryLocalAssetRepository repositoryLocalAssetRepository,
            RepositoryDefinitionRepository repositoryDefinitionRepository,
            ManagedSkillRepository managedSkillRepository,
            ScriptApplicationService scriptApplicationService,
            ConfigValueApplicationService configValueApplicationService,
            PluginRuntimeService pluginRuntimeService,
            RepositoryPluginService repositoryPluginService,
            RepositoryScriptService repositoryToolService) {
        return new RepositoryCapabilityPackageService(
                repositoryCatalogService,
                new RepositoryCatalogService.Repositories(
                        repositoryDefinitionRepository,
                        capabilityPackageInstallationRepository,
                        managedSkillRepository,
                        scriptRepository,
                        scriptScheduleRepository,
                        executionPresetRepository,
                        configValueRepository,
                        webhookRepository,
                        repositoryLocalAssetRepository,
                        aiModelProfileRepository,
                        aiAgentProfileRepository,
                        aiToolsetRepository
                ),
                new RepositoryCatalogService.ApplicationServices(
                        scriptApplicationService,
                        configValueApplicationService,
                        pluginRuntimeService
                ),
                repositoryPluginService,
                repositoryToolService,
                repositoryCatalogService.getConfigTemplateSyncService(),
                repositoryCatalogService.getAiPackageService()
        );
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
                new ConfigValueUsageAnalysisService.Repositories(
                        configValueRepository,
                        scriptRepository,
                        scriptScheduleRepository,
                        pluginRegistryRepository
                ),
                new ConfigValueUsageAnalysisService.ApplicationServices(
                        pluginId -> pluginRuntimeService.getConfig(pluginId).getConfig(),
                        repositoryCatalogService::listRepositories,
                        repositoryCatalogService::listRepositoryScripts,
                        repositoryCatalogService::listAllRepositoryScripts,
                        repositoryCatalogService::getRepositoryScript,
                        aiModelProfileRepository::findAll
                )
        );
    }

    @Bean
    public RepositorySkillService repositorySkillService(RepositoryCatalogService repositoryCatalogService,
                                                          JsonCodec jsonCodec,
                                                          AppProperties properties) {
        return new RepositorySkillService(
                repositoryCatalogService,
                jsonCodec,
                repositoryCatalogService.getRepositoriesRoot()
        );
    }

    @Bean
    public RepositoryWebhookService repositoryWebhookService(RepositoryCatalogService repositoryCatalogService,
                                                                     RepositoryScriptService repositoryToolService) {
        return new RepositoryWebhookService(
                repositoryCatalogService,
                repositoryCatalogService.getRepos(),
                repositoryCatalogService.getConfigTemplateSyncService(),
                repositoryToolService
        );
    }

    @Bean
    public RepositoryKnowledgeService repositoryKnowledgeService(RepositoryCatalogService repositoryCatalogService) {
        return new RepositoryKnowledgeService(repositoryCatalogService);
    }
}
