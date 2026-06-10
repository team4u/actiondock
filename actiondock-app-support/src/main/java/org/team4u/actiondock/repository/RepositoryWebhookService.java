package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.WebhookDefinition;
import org.team4u.actiondock.domain.model.WebhookScope;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.RepositoryLocalAssetMode;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.common.NormalizeUtils;

import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

public class RepositoryWebhookService {

    private final RepositoryCatalogService catalog;
    private final RepositoryCatalogService.Repositories repos;
    private final UpstreamSyncService upstreamSync;
    private final WebhookRepositoryPublisher publisher;
    private final RepositoryConfigTemplateSyncService configTemplateSyncService;
    private final RepositoryScriptService repositoryToolService;
    private final RepositoryDependencyResolver dependencyResolver;
    private final RepositoryScriptDependencyPublishPlanner dependencyPlanner;

    public RepositoryWebhookService(RepositoryCatalogService catalog,
                                        RepositoryCatalogService.Repositories repos,
                                        RepositoryConfigTemplateSyncService configTemplateSyncService,
                                        RepositoryScriptService repositoryToolService) {
        this.catalog = catalog;
        this.repos = repos;
        this.configTemplateSyncService = configTemplateSyncService;
        this.repositoryToolService = repositoryToolService;
        this.upstreamSync = new UpstreamSyncService(catalog, repos, catalog.getServices());
        this.dependencyPlanner = new RepositoryScriptDependencyPublishPlanner(catalog, repositoryToolService.publisher());
        this.publisher = new WebhookRepositoryPublisher(catalog, repos, dependencyPlanner);
        this.dependencyResolver = new RepositoryDependencyResolver(catalog);
    }

    public RepositoryWebhookPublishPreview previewPublish(RepositoryWebhookPublishPreviewRequest request) {
        return publisher.preview(request);
    }

    public RepositoryWebhookDescriptor publishWebhook(String repositoryId, RepositoryWebhookPublishRequest request) {
        RepositoryWebhookDescriptor descriptor = publisher.publish(repositoryId, request);
        catalog.refreshRepositoryCache(repositoryId);
        return descriptor;
    }

    public RepositoryLocalAsset addLocalAsset(String repositoryId,
                                             String webhookId,
                                             RepositoryLocalAssetRequest request) {
        RepositoryLocalAssetMode mode = parseMode(request == null ? null : request.mode());
        if (mode == RepositoryLocalAssetMode.TRACKED) {
            WebhookDefinition source = upstreamSync.createWebhookWorkingCopy(repositoryId, webhookId,
                    new WorkingCopyRequest(request == null ? null : request.localAssetId()));
            return repos.repositoryLocalAssetRepository()
                    .findByLocalAsset(UpstreamAssetType.WEBHOOK, source.getId())
                    .orElseThrow(() -> new IllegalStateException("本地Webhook资产记录未创建: " + source.getId()));
        }
        return installOrUpdate(repositoryId, webhookId,
                request == null ? ToolInstallationOptions.DEFAULT : request.toOptions(),
                false,
                new LinkedHashSet<>());
    }

    public RepositoryLocalAsset updateLocalAsset(String repositoryId,
                                                String webhookId,
                                                ToolInstallationOptions options) {
        return installOrUpdate(repositoryId, webhookId, options, true, new LinkedHashSet<>());
    }

    public UpstreamStatus getUpstreamStatus(String webhookId) {
        return upstreamSync.getWebhookUpstreamStatus(webhookId);
    }

    public WebhookDefinition pullUpstreamWebhook(String webhookId, boolean force) {
        return upstreamSync.pullWebhook(webhookId, force);
    }

    public void detachUpstream(String webhookId) {
        upstreamSync.detachWebhook(webhookId);
    }

    public void uninstallWebhook(String localAssetId) {
        WebhookDefinition source = repos.webhookRepository().findById(localAssetId)
                .orElseThrow(() -> new IllegalArgumentException("本地Webhook不存在: " + localAssetId));
        repos.webhookRepository().deleteById(source.getId());
        repos.repositoryLocalAssetRepository()
                .findByLocalAsset(UpstreamAssetType.WEBHOOK, localAssetId)
                .ifPresent(asset -> repos.repositoryLocalAssetRepository().deleteById(asset.getId()));
        configTemplateSyncService.removeManagedConfigTemplates(source.getRepositoryId(), source.getRepositoryWebhookId());
    }

    private RepositoryLocalAsset installOrUpdate(String repositoryId,
                                                 String webhookId,
                                                 ToolInstallationOptions options,
                                                 boolean updateOnly,
                                                 LinkedHashSet<String> visiting) {
        String installationKey = repositoryId + ":" + webhookId;
        if (!visiting.add(installationKey)) {
            throw new IllegalStateException("检测到Webhook循环依赖: " + String.join(" -> ", visiting) + " -> " + installationKey);
        }
        try {
            RepositoryWebhookDetail detail = catalog.getRepositoryWebhook(repositoryId, webhookId);
            RepositoryLocalAsset existingAsset = repos.repositoryLocalAssetRepository()
                    .findByUpstreamAsset(UpstreamAssetType.WEBHOOK, repositoryId, webhookId)
                    .orElse(null);
            if (existingAsset != null && existingAsset.getMode() != RepositoryLocalAssetMode.LOCKED) {
                throw new IllegalArgumentException("上游Webhook已添加为可编辑跟踪资产，不能按只读资产更新: " + existingAsset.getLocalAssetId());
            }
            if (!updateOnly && existingAsset != null) {
                throw new IllegalArgumentException("上游Webhook已添加到本地: " + existingAsset.getLocalAssetId());
            }
            if (updateOnly && existingAsset == null) {
                throw new IllegalArgumentException("Webhook尚未添加为只读本地资产: " + repositoryId + "/" + webhookId);
            }
            String localAssetId = existingAsset == null ? repositoryId + "." + webhookId : existingAsset.getLocalAssetId();
            WebhookDefinition existing = repos.webhookRepository().findById(localAssetId).orElse(null);
            if (updateOnly && existing == null) {
                throw new IllegalArgumentException("Webhook尚未添加为只读本地资产: " + repositoryId + "/" + webhookId);
            }
            resolveScriptDependencies(repositoryId, detail, options, visiting);
            return persistInstallation(repositoryId, detail, localAssetId, existing);
        } finally {
            visiting.remove(installationKey);
        }
    }

    private void resolveScriptDependencies(String repositoryId,
                                           RepositoryWebhookDetail detail,
                                           ToolInstallationOptions options,
                                           LinkedHashSet<String> visiting) {
        for (ScriptDependency dependency : NormalizeUtils.nullSafeList(detail.descriptor().scriptDependencies())) {
            String dependencyToolId = NormalizeUtils.normalize(dependency.getRepositoryScriptId(), "repositoryScriptId 不能为空");
            String dependencyRepositoryId = dependencyResolver.resolveToolRepositoryId(repositoryId, dependency.getRepositoryId(), dependencyToolId);
            ScriptDefinition installed = repos.scriptRepository()
                    .findInstalledByRepositorySource(
                            dependencyRepositoryId,
                            dependencyToolId)
                    .orElse(null);
            if (installed != null && RepositoryVersionUtils.versionSatisfies(installed.getRepositoryVersion(), dependency.getVersionRange())) {
                continue;
            }
            if (!options.installScriptDependencies()) {
                throw new IllegalArgumentException("缺少Webhook依赖脚本: " + dependencyRepositoryId + "/" + dependencyToolId);
            }
            repositoryToolService.addLocalAsset(
                    dependencyRepositoryId,
                    dependencyToolId,
                    new RepositoryLocalAssetRequest("LOCKED", null, false, true, options.installPluginDependencies(), options.forcePluginUpgrade())
            );
        }
    }

    private RepositoryLocalAsset persistInstallation(String repositoryId,
                                                     RepositoryWebhookDetail detail,
                                                     String localAssetId,
                                                     WebhookDefinition existing) {
        LocalDateTime now = LocalDateTime.now();
        WebhookDefinition source = buildLockedWebhook(detail, localAssetId, existing, now);
        repos.webhookRepository().save(source);
        configTemplateSyncService.syncConfigTemplates(repositoryId, detail.descriptor().webhookId(), detail.descriptor().version(), detail.configTemplate());
        return saveLockedLocalAsset(detail, source, existing, now);
    }

    private WebhookDefinition buildLockedWebhook(RepositoryWebhookDetail detail,
                                                         String localAssetId,
                                                         WebhookDefinition existing,
                                                         LocalDateTime now) {
        WebhookDefinition source = new WebhookDefinition()
                .setId(localAssetId)
                .setKey(localAssetId)
                .setName(detail.descriptor().displayName())
                .setDescription(detail.webhook().description())
                .setScope(WebhookScope.REPOSITORY)
                .setRepositoryId(detail.descriptor().repositoryId())
                .setRepositoryWebhookId(detail.descriptor().webhookId())
                .setRepositoryVersion(detail.descriptor().version())
                .setTransport(detail.webhook().transport())
                .setWebhookScriptId(detail.webhook().webhookScriptId())
                .setSampleRequest(detail.webhook().sampleRequest())
                .setEditable(false)
                .setEnabled(existing == null ? true : existing.isEnabled())
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now)
                .setLastReceivedAt(existing == null ? null : existing.getLastReceivedAt());
        return source;
    }

    private RepositoryLocalAsset saveLockedLocalAsset(RepositoryWebhookDetail detail,
                                                      WebhookDefinition source,
                                                      WebhookDefinition existing,
                                                      LocalDateTime now) {
        RepositoryLocalAsset previous = repos.repositoryLocalAssetRepository()
                .findByLocalAsset(UpstreamAssetType.WEBHOOK, source.getId())
                .orElse(null);
        return repos.repositoryLocalAssetRepository().save(new RepositoryLocalAsset()
                .setId(previous == null ? "WEBHOOK:LOCKED:" + source.getId() : previous.getId())
                .setAssetType(UpstreamAssetType.WEBHOOK)
                .setLocalAssetId(source.getId())
                .setRepositoryId(source.getRepositoryId())
                .setUpstreamAssetId(source.getRepositoryWebhookId())
                .setMode(RepositoryLocalAssetMode.LOCKED)
                .setVersion(detail.descriptor().version())
                .setLatestVersion(detail.descriptor().version())
                .setName(source.getName())
                .setOwner(detail.descriptor().owner())
                .setDescription(detail.descriptor().description())
                .setCreatedAt(previous == null ? (existing == null ? now : existing.getCreatedAt()) : previous.getCreatedAt())
                .setUpdatedAt(now));
    }

    private RepositoryLocalAssetMode parseMode(String mode) {
        if (NormalizeUtils.isBlank(mode)) {
            return RepositoryLocalAssetMode.LOCKED;
        }
        return RepositoryLocalAssetMode.valueOf(mode);
    }

}
