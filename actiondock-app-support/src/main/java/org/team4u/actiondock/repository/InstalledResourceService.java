package org.team4u.actiondock.repository;

import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.domain.model.CapabilityPackageInstallation;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.domain.model.WebhookDefinition;
import org.team4u.actiondock.plugin.PluginReferenceSourceType;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.common.NormalizeUtils;
import org.team4u.actiondock.skill.SkillService;

import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Lists and removes resources installed from discovery repositories.
 */
public class InstalledResourceService {
    private static final String TYPE_SCRIPT = "SCRIPT";
    private static final String TYPE_WEBHOOK = "WEBHOOK";
    private static final String TYPE_CONFIG_VALUE = "CONFIG_VALUE";
    private static final String TYPE_CAPABILITY_PACKAGE = "CAPABILITY_PACKAGE";
    private static final String TYPE_KNOWLEDGE = "KNOWLEDGE";
    private static final String TYPE_SKILL = "SKILL";
    private static final String TYPE_PLUGIN = "PLUGIN";
    private static final String TYPE_PLAYBOOK = "PLAYBOOK";
    private static final String KNOWLEDGE_REPO_ID_PREFIX = "knowledge:";

    private final RepositoryCatalogService catalog;
    private final RepositoryScriptService scriptService;
    private final RepositoryWebhookService webhookService;
    private final RepositoryPlaybookService playbookService;
    private final RepositoryCapabilityPackageService capabilityPackageService;
    private final RepositoryKnowledgeService knowledgeService;
    private final SkillService skillService;
    private final PluginRuntimeService pluginRuntimeService;
    private final ConfigValueApplicationService configValueService;

    public InstalledResourceService(RepositoryCatalogService catalog,
                                    RepositoryScriptService scriptService,
                                    RepositoryWebhookService webhookService,
                                    RepositoryPlaybookService playbookService,
                                    RepositoryCapabilityPackageService capabilityPackageService,
                                    RepositoryKnowledgeService knowledgeService,
                                    SkillService skillService,
                                    PluginRuntimeService pluginRuntimeService,
                                    ConfigValueApplicationService configValueService) {
        this.catalog = catalog;
        this.scriptService = scriptService;
        this.webhookService = webhookService;
        this.playbookService = playbookService;
        this.capabilityPackageService = capabilityPackageService;
        this.knowledgeService = knowledgeService;
        this.skillService = skillService;
        this.pluginRuntimeService = pluginRuntimeService;
        this.configValueService = configValueService == null ? ConfigValueApplicationService.disabled() : configValueService;
    }

    public List<InstalledResourceView> list() {
        Map<String, RepositoryDefinition> repositories = catalog.listRepositories().stream()
                .collect(Collectors.toMap(RepositoryDefinition::getId, Function.identity(), (left, right) -> left));
        Set<String> scriptPackageIds = catalog.getRepos().capabilityPackageInstallationRepository().findAll().stream()
                .flatMap(installation -> installation.getScriptIds().stream())
                .collect(Collectors.toSet());
        Set<String> playbookPackageIds = catalog.getRepos().capabilityPackageInstallationRepository().findAll().stream()
                .flatMap(installation -> installation.getPlaybookIds().stream())
                .collect(Collectors.toSet());
        return java.util.stream.Stream.of(
                        scriptResources(repositories, scriptPackageIds),
                        webhookResources(repositories),
                        playbookResources(repositories, playbookPackageIds),
                        configValueResources(repositories),
                        capabilityPackageResources(repositories),
                        knowledgeResources(repositories),
                        skillResources(repositories),
                        pluginResources(repositories)
                )
                .flatMap(List::stream)
                .sorted(Comparator.comparing(InstalledResourceView::type).thenComparing(InstalledResourceView::id))
                .toList();
    }

    public void uninstall(String type, String id) {
        String normalizedType = NormalizeUtils.normalize(type, "type 不能为空").toUpperCase(java.util.Locale.ROOT);
        String normalizedId = NormalizeUtils.normalize(id, "id 不能为空");
        switch (normalizedType) {
            case TYPE_SCRIPT -> scriptService.uninstallScript(normalizedId);
            case TYPE_WEBHOOK -> webhookService.uninstallWebhook(normalizedId);
            case TYPE_PLAYBOOK -> playbookService.uninstallPlaybook(normalizedId);
            case TYPE_CONFIG_VALUE -> configValueService.delete(normalizedId);
            case TYPE_CAPABILITY_PACKAGE -> capabilityPackageService.uninstallCapabilityPackageByInstallationId(normalizedId);
            case TYPE_KNOWLEDGE -> knowledgeService.uninstallKnowledgeByInstalledRepositoryId(normalizedId);
            case TYPE_SKILL -> skillService.uninstallSkill(normalizedId);
            case TYPE_PLUGIN -> pluginRuntimeService.uninstall(normalizedId, false);
            default -> throw new IllegalArgumentException("不支持的已安装资源类型: " + type);
        }
    }

    private List<InstalledResourceView> scriptResources(Map<String, RepositoryDefinition> repositories,
                                                        Set<String> scriptPackageIds) {
        Map<String, ScriptDefinition> scriptsById = catalog.getRepos().scriptRepository().findAll().stream()
                .collect(Collectors.toMap(ScriptDefinition::getId, Function.identity(), (left, right) -> left));
        return catalog.getRepos().repositoryLocalAssetRepository().findAll().stream()
                .filter(asset -> asset.getAssetType() == UpstreamAssetType.SCRIPT)
                .filter(asset -> !scriptPackageIds.contains(asset.getLocalAssetId()))
                .map(asset -> {
                    ScriptDefinition script = scriptsById.get(asset.getLocalAssetId());
                    return view(
                            TYPE_SCRIPT,
                            asset.getLocalAssetId(),
                            script == null ? asset.getName() : script.getName(),
                            asset.getDescription(),
                            asset.getRepositoryId(),
                            asset.getUpstreamAssetId(),
                            asset.getVersion(),
                            asset.getUpdatedAt(),
                            repositories
                    );
                })
                .toList();
    }

    private List<InstalledResourceView> webhookResources(Map<String, RepositoryDefinition> repositories) {
        Map<String, WebhookDefinition> webhooksById = catalog.getRepos().webhookRepository().findAll().stream()
                .collect(Collectors.toMap(WebhookDefinition::getId, Function.identity(), (left, right) -> left));
        return catalog.getRepos().repositoryLocalAssetRepository().findAll().stream()
                .filter(asset -> asset.getAssetType() == UpstreamAssetType.WEBHOOK)
                .map(asset -> {
                    WebhookDefinition webhook = webhooksById.get(asset.getLocalAssetId());
                    return view(
                            TYPE_WEBHOOK,
                            asset.getLocalAssetId(),
                            webhook == null ? asset.getName() : webhook.getName(),
                            asset.getDescription(),
                            asset.getRepositoryId(),
                            asset.getUpstreamAssetId(),
                            asset.getVersion(),
                            asset.getUpdatedAt(),
                            repositories
                    );
                })
                .toList();
    }

    private List<InstalledResourceView> playbookResources(Map<String, RepositoryDefinition> repositories,
                                                          Set<String> playbookPackageIds) {
        Map<String, Playbook> playbooksById = catalog.getRepos().playbookRepository().findAll().stream()
                .collect(Collectors.toMap(Playbook::getId, Function.identity(), (left, right) -> left));
        return catalog.getRepos().repositoryLocalAssetRepository().findAll().stream()
                .filter(asset -> asset.getAssetType() == UpstreamAssetType.PLAYBOOK)
                .filter(asset -> !playbookPackageIds.contains(asset.getLocalAssetId()))
                .map(asset -> {
                    Playbook playbook = playbooksById.get(asset.getLocalAssetId());
                    return view(
                            TYPE_PLAYBOOK,
                            asset.getLocalAssetId(),
                            playbook == null ? asset.getName() : playbook.getName(),
                            asset.getDescription(),
                            asset.getRepositoryId(),
                            asset.getUpstreamAssetId(),
                            asset.getVersion(),
                            asset.getUpdatedAt(),
                            repositories
                    );
                })
                .toList();
    }

    private List<InstalledResourceView> configValueResources(Map<String, RepositoryDefinition> repositories) {
        return catalog.getRepos().configValueRepository().findAll().stream()
                .filter(value -> NormalizeUtils.isNotBlank(value.getRepositoryId()))
                .map(value -> view(
                        TYPE_CONFIG_VALUE,
                        value.getKey(),
                        value.getKey(),
                        value.getDescription(),
                        value.getRepositoryId(),
                        value.getRepositoryScriptId(),
                        value.getRepositoryVersion(),
                        value.getUpdatedAt(),
                        repositories
                ))
                .toList();
    }

    private List<InstalledResourceView> capabilityPackageResources(Map<String, RepositoryDefinition> repositories) {
        return catalog.getRepos().capabilityPackageInstallationRepository().findAll().stream()
                .map(installation -> view(
                        TYPE_CAPABILITY_PACKAGE,
                        installation.getInstallationId(),
                        NormalizeUtils.normalizeOrDefault(installation.getName(), installation.getPackageId()),
                        installation.getDescription(),
                        installation.getRepositoryId(),
                        installation.getPackageId(),
                        installation.getVersion(),
                        installation.getUpdatedAt(),
                        repositories
                ))
                .toList();
    }

    private List<InstalledResourceView> knowledgeResources(Map<String, RepositoryDefinition> repositories) {
        return catalog.listRepositories().stream()
                .filter(repository -> RepositoryKnowledgeService.isInstalledKnowledgeRepositoryId(repository.getId()))
                .map(repository -> {
                    KnowledgeSource source = parseKnowledgeSource(repository.getId());
                    return view(
                            TYPE_KNOWLEDGE,
                            repository.getId(),
                            repository.getName(),
                            repository.getDescription(),
                            source.repositoryId(),
                            source.knowledgeId(),
                            null,
                            repository.getUpdatedAt(),
                            repositories
                    );
                })
                .toList();
    }

    private List<InstalledResourceView> skillResources(Map<String, RepositoryDefinition> repositories) {
        return catalog.getRepos().managedSkillRepository().findAll().stream()
                .filter(skill -> NormalizeUtils.isNotBlank(skill.getRepositoryId()))
                .map(skill -> view(
                        TYPE_SKILL,
                        skill.getSkillId(),
                        NormalizeUtils.normalizeOrDefault(skill.getDisplayName(), skill.getSkillId()),
                        skill.getDescription(),
                        skill.getRepositoryId(),
                        skill.getSkillId(),
                        skill.getVersion(),
                        skill.getUpdatedAt(),
                        repositories
                ))
                .toList();
    }

    private List<InstalledResourceView> pluginResources(Map<String, RepositoryDefinition> repositories) {
        return pluginRuntimeService.list().stream()
                .filter(plugin -> plugin.getSourceType() != PluginReferenceSourceType.SYSTEM)
                .filter(plugin -> NormalizeUtils.isNotBlank(plugin.getRepositoryId()))
                .map(plugin -> view(
                        TYPE_PLUGIN,
                        plugin.getPluginId(),
                        NormalizeUtils.normalizeOrDefault(plugin.getName(), plugin.getPluginId()),
                        plugin.getDescription(),
                        plugin.getRepositoryId(),
                        NormalizeUtils.normalizeOrDefault(plugin.getRepositoryPluginId(), plugin.getPluginId()),
                        plugin.getRepositoryVersion(),
                        null,
                        repositories
                ))
                .toList();
    }

    private static InstalledResourceView view(String type,
                                              String id,
                                              String displayName,
                                              String description,
                                              String repositoryId,
                                              String upstreamId,
                                              String version,
                                              LocalDateTime updatedAt,
                                              Map<String, RepositoryDefinition> repositories) {
        boolean repositoryExists = NormalizeUtils.isNotBlank(repositoryId) && repositories.containsKey(repositoryId);
        String repositoryName = repositoryExists ? repositories.get(repositoryId).getName() : null;
        return new InstalledResourceView(
                type,
                id,
                NormalizeUtils.normalizeOrDefault(displayName, id),
                description,
                repositoryId,
                repositoryName,
                upstreamId,
                version,
                repositoryExists,
                NormalizeUtils.isNotBlank(repositoryId) && !repositoryExists,
                updatedAt
        );
    }

    private static KnowledgeSource parseKnowledgeSource(String installedRepositoryId) {
        String value = installedRepositoryId.substring(KNOWLEDGE_REPO_ID_PREFIX.length());
        int splitAt = value.indexOf(':');
        if (splitAt <= 0 || splitAt == value.length() - 1) {
            return new KnowledgeSource(null, installedRepositoryId);
        }
        return new KnowledgeSource(value.substring(0, splitAt), value.substring(splitAt + 1));
    }

    public record InstalledResourceView(
            String type,
            String id,
            String displayName,
            String description,
            String repositoryId,
            String repositoryName,
            String upstreamId,
            String version,
            boolean repositoryExists,
            boolean orphan,
            LocalDateTime updatedAt
    ) {
    }

    private record KnowledgeSource(String repositoryId, String knowledgeId) {
    }
}
