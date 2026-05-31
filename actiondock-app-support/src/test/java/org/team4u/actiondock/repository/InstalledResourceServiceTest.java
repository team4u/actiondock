package org.team4u.actiondock.repository;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.CapabilityPackageInstallation;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.domain.model.WebhookDefinition;
import org.team4u.actiondock.domain.port.CapabilityPackageInstallationRepository;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.ExecutionPresetRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ManagedSkillRepository;
import org.team4u.actiondock.domain.port.PlaybookRepository;
import org.team4u.actiondock.domain.port.RepositoryDefinitionRepository;
import org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.domain.port.WebhookRepository;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.skill.SkillService;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class InstalledResourceServiceTest {

    private final RepositoryDefinitionRepository repositoryDefinitionRepository = mock(RepositoryDefinitionRepository.class);
    private final CapabilityPackageInstallationRepository packageInstallationRepository = mock(CapabilityPackageInstallationRepository.class);
    private final ManagedSkillRepository managedSkillRepository = mock(ManagedSkillRepository.class);
    private final ScriptRepository scriptRepository = mock(ScriptRepository.class);
    private final ScriptScheduleRepository scriptScheduleRepository = mock(ScriptScheduleRepository.class);
    private final ExecutionPresetRepository executionPresetRepository = mock(ExecutionPresetRepository.class);
    private final ConfigValueRepository configValueRepository = mock(ConfigValueRepository.class);
    private final WebhookRepository webhookRepository = mock(WebhookRepository.class);
    private final PlaybookRepository playbookRepository = mock(PlaybookRepository.class);
    private final RepositoryLocalAssetRepository localAssetRepository = mock(RepositoryLocalAssetRepository.class);
    private final org.team4u.actiondock.ai.api.AiModelProfileRepository aiModelProfileRepository =
            mock(org.team4u.actiondock.ai.api.AiModelProfileRepository.class);
    private final org.team4u.actiondock.ai.api.AiAgentProfileRepository aiAgentProfileRepository =
            mock(org.team4u.actiondock.ai.api.AiAgentProfileRepository.class);
    private final org.team4u.actiondock.ai.api.AiToolsetRepository aiToolsetRepository =
            mock(org.team4u.actiondock.ai.api.AiToolsetRepository.class);
    private final RepositoryCapabilityPackageService capabilityPackageService = mock(RepositoryCapabilityPackageService.class);
    private final RepositoryKnowledgeService knowledgeService = mock(RepositoryKnowledgeService.class);
    private final RepositoryPlaybookService playbookService = mock(RepositoryPlaybookService.class);
    private final SkillService skillService = mock(SkillService.class);
    private final PluginRuntimeService pluginRuntimeService = mock(PluginRuntimeService.class);

    @Test
    void listsInstalledResourcesAndMarksDeletedSourceRepositoryAsOrphan() {
        when(repositoryDefinitionRepository.findAll()).thenReturn(List.of(new RepositoryDefinition()
                .setId("repo-live")
                .setName("Live Repo")));
        when(packageInstallationRepository.findAll()).thenReturn(List.of(new CapabilityPackageInstallation()
                .setInstallationId("repo-live:pkg")
                .setRepositoryId("repo-live")
                .setPackageId("pkg")
                .setName("Package")
                .setScriptIds(List.of("package-script"))));
        when(scriptRepository.findAll()).thenReturn(List.of(
                new ScriptDefinition().setId("script-live").setName("Live Script"),
                new ScriptDefinition().setId("script-orphan").setName("Orphan Script"),
                new ScriptDefinition().setId("package-script").setName("Package Script")
        ));
        when(webhookRepository.findAll()).thenReturn(List.of(new WebhookDefinition()
                .setId("webhook-orphan")
                .setName("Orphan Webhook")));
        when(localAssetRepository.findAll()).thenReturn(List.of(
                localAsset("asset-live", UpstreamAssetType.SCRIPT, "script-live", "repo-live", "upstream-live"),
                localAsset("asset-orphan", UpstreamAssetType.SCRIPT, "script-orphan", "repo-deleted", "upstream-orphan"),
                localAsset("asset-package", UpstreamAssetType.SCRIPT, "package-script", "repo-live", "package-upstream"),
                localAsset("asset-webhook", UpstreamAssetType.WEBHOOK, "webhook-orphan", "repo-deleted", "webhook-upstream")
        ));
        when(configValueRepository.findAll()).thenReturn(List.of());
        when(managedSkillRepository.findAll()).thenReturn(List.of());
        when(pluginRuntimeService.list()).thenReturn(List.of());

        List<InstalledResourceService.InstalledResourceView> resources = service().list();

        assertThat(resources)
                .extracting(InstalledResourceService.InstalledResourceView::id)
                .contains("script-live", "script-orphan", "webhook-orphan", "repo-live:pkg")
                .doesNotContain("package-script");
        assertThat(resources)
                .filteredOn(resource -> resource.id().equals("script-live"))
                .singleElement()
                .satisfies(resource -> {
                    assertThat(resource.repositoryExists()).isTrue();
                    assertThat(resource.orphan()).isFalse();
                    assertThat(resource.repositoryName()).isEqualTo("Live Repo");
                });
        assertThat(resources)
                .filteredOn(resource -> resource.id().equals("script-orphan"))
                .singleElement()
                .satisfies(resource -> {
                    assertThat(resource.repositoryExists()).isFalse();
                    assertThat(resource.orphan()).isTrue();
                    assertThat(resource.repositoryId()).isEqualTo("repo-deleted");
                });
    }

    @Test
    void uninstallCapabilityPackageUsesInstallationId() {
        service().uninstall("CAPABILITY_PACKAGE", "repo-deleted:pkg");

        verify(capabilityPackageService).uninstallCapabilityPackageByInstallationId("repo-deleted:pkg");
    }

    @Test
    void listsAndUninstallsRepositoryPlaybooks() {
        when(repositoryDefinitionRepository.findAll()).thenReturn(List.of(new RepositoryDefinition()
                .setId("repo-live")
                .setName("Live Repo")));
        when(packageInstallationRepository.findAll()).thenReturn(List.of());
        when(scriptRepository.findAll()).thenReturn(List.of());
        when(webhookRepository.findAll()).thenReturn(List.of());
        when(configValueRepository.findAll()).thenReturn(List.of());
        when(managedSkillRepository.findAll()).thenReturn(List.of());
        when(pluginRuntimeService.list()).thenReturn(List.of());
        when(localAssetRepository.findAll()).thenReturn(List.of(
                localAsset("asset-playbook", UpstreamAssetType.PLAYBOOK, "repo-live.refund-guide", "repo-live", "refund-guide")
        ));
        when(playbookRepository.findAll()).thenReturn(List.of(new Playbook()
                .setId("repo-live.refund-guide")
                .setName("Refund Guide")));

        List<InstalledResourceService.InstalledResourceView> resources = service().list();

        assertThat(resources)
                .filteredOn(resource -> resource.id().equals("repo-live.refund-guide"))
                .singleElement()
                .satisfies(resource -> assertThat(resource.type()).isEqualTo("PLAYBOOK"));

        service().uninstall("PLAYBOOK", "repo-live.refund-guide");
        verify(playbookService).uninstallPlaybook("repo-live.refund-guide");
    }

    private InstalledResourceService service() {
        RepositoryCatalogService catalog = new RepositoryCatalogService(
                new RepositoryCatalogService.Repositories(
                        repositoryDefinitionRepository,
                        packageInstallationRepository,
                        managedSkillRepository,
                        scriptRepository,
                        scriptScheduleRepository,
                        executionPresetRepository,
                        configValueRepository,
                        webhookRepository,
                        localAssetRepository,
                        aiModelProfileRepository,
                        aiAgentProfileRepository,
                        aiToolsetRepository,
                        playbookRepository
                ),
                new RepositoryCatalogService.ApplicationServices(
                        new ScriptApplicationService(scriptRepository, mock(org.team4u.actiondock.domain.port.ScriptEngine.class), scriptScheduleRepository, localAssetRepository),
                        new ConfigValueApplicationService(configValueRepository),
                        pluginRuntimeService
                ),
                mock(JsonCodec.class),
                new AppProperties(),
                mock(PluginArtifactResolverRegistry.class)
        );
        RepositoryPluginService repositoryPluginService = mock(RepositoryPluginService.class);
        RepositoryScriptService scriptService = new RepositoryScriptService(
                catalog,
                repositoryPluginService,
                catalog.getRepos(),
                catalog.getServices(),
                catalog.getConfigTemplateSyncService()
        );
        RepositoryWebhookService webhookService = new RepositoryWebhookService(
                catalog,
                catalog.getRepos(),
                catalog.getConfigTemplateSyncService(),
                scriptService
        );
        return new InstalledResourceService(
                catalog,
                scriptService,
                webhookService,
                playbookService,
                capabilityPackageService,
                knowledgeService,
                skillService,
                pluginRuntimeService,
                new ConfigValueApplicationService(configValueRepository)
        );
    }

    private static RepositoryLocalAsset localAsset(String id,
                                                   UpstreamAssetType assetType,
                                                   String localAssetId,
                                                   String repositoryId,
                                                   String upstreamAssetId) {
        return new RepositoryLocalAsset()
                .setId(id)
                .setAssetType(assetType)
                .setLocalAssetId(localAssetId)
                .setRepositoryId(repositoryId)
                .setUpstreamAssetId(upstreamAssetId)
                .setName(localAssetId)
                .setVersion("1.0.0");
    }
}
