package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.exception.UpstreamConflictException;
import org.team4u.actiondock.domain.model.WebhookDefinition;
import org.team4u.actiondock.domain.model.WebhookScope;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.RepositoryLocalAssetMode;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

final class WebhookRepositoryPublisher {

    private static final String WEBHOOK_CONFIG_TEMPLATE_FILE = "config.template.json";

    private final RepositoryCatalogService catalog;
    private final RepositoryCatalogService.Repositories repos;
    private final RepositoryScriptDependencyPublishPlanner dependencyPlanner;

    WebhookRepositoryPublisher(RepositoryCatalogService catalog,
                               RepositoryCatalogService.Repositories repos,
                               RepositoryScriptDependencyPublishPlanner dependencyPlanner) {
        this.catalog = catalog;
        this.repos = repos;
        this.dependencyPlanner = dependencyPlanner;
    }

    RepositoryWebhookDescriptor publish(String repositoryId, RepositoryWebhookPublishRequest request) {
        WritableRepositorySession session = catalog.openWritableRepositorySession(repositoryId);
        RepositoryDefinition repository = session.repository();
        WebhookDefinition source = requireSource(request.sourceId());
        RepositoryLocalAsset upstreamBinding = repos.repositoryLocalAssetRepository()
                .findByLocalAsset(UpstreamAssetType.WEBHOOK, source.getId())
                .filter(asset -> asset.getMode() == RepositoryLocalAssetMode.TRACKED)
                .orElse(null);
        if (upstreamBinding != null && Objects.equals(upstreamBinding.getRepositoryId(), repositoryId) && !request.force()) {
            assertUpstreamPublishSafe(source, repository, upstreamBinding);
        }

        String webhookId = NormalizeUtils.normalize(request.webhookId(), "webhookId 不能为空");
        String version = NormalizeUtils.normalize(request.version(), "version 不能为空");
        List<ScriptDependency> scriptDependencies = dependencyPlanner.resolvePublishDependencies(
                source.getWebhookScriptId(),
                repositoryId,
                request.scriptDependencies()
        );
        if (request.publishScriptDependencies()) {
            dependencyPlanner.publishDependencies(repositoryId, source.getWebhookScriptId(), scriptDependencies, request.force());
        }
        List<ConfigTemplateItem> configTemplates = buildConfigTemplates(source, request.configItems());

        assertWebhookVersionAvailable(repositoryId, session.index(), webhookId, version);
        Path webhookDir = session.root().resolve(WEBHOOKS_DIR).resolve(webhookId);
        WebhookFile file = buildWebhookFile(source, request, webhookId, configTemplates, scriptDependencies);
        catalog.writeJson(webhookDir.resolve(WEBHOOK_DESCRIPTOR_FILE), file);
        if (!configTemplates.isEmpty()) {
            catalog.writeJson(webhookDir.resolve(WEBHOOK_CONFIG_TEMPLATE_FILE), configTemplates);
        }
        session.commitPublishedAsset(webhookId, version, request.releaseNotes());
        catalog.refreshRepositoryCache(repositoryId);

        RepositoryWebhookDetail publishedDetail = catalog.getRepositoryWebhook(repositoryId, webhookId);
        if (upstreamBinding != null
                && Objects.equals(upstreamBinding.getRepositoryId(), repositoryId)
                && Objects.equals(upstreamBinding.getUpstreamAssetId(), webhookId)) {
            updateTrackedLocalAsset(upstreamBinding, publishedDetail);
        }
        return publishedDetail.descriptor();
    }

    RepositoryWebhookPublishPreview preview(RepositoryWebhookPublishPreviewRequest request) {
        WebhookDefinition source = requireSource(request.sourceId());
        List<RepositoryWebhookPublishDependencyDraft> dependencyDrafts = dependencyPlanner.preview(
                source.getWebhookScriptId(),
                NormalizeUtils.normalizeNullable(request.repositoryId()),
                request.scriptDependencies()
        );
        List<ScriptDependency> dependencies = dependencyDrafts.stream()
                .filter(item -> NormalizeUtils.isNotBlank(item.repositoryId()) && NormalizeUtils.isNotBlank(item.repositoryScriptId()))
                .map(item -> new ScriptDependency()
                        .setScriptId(item.scriptId())
                        .setRepositoryId(item.repositoryId())
                        .setRepositoryScriptId(item.repositoryScriptId())
                        .setVersionRange(item.versionRange()))
                .toList();
        RepositoryPublishConfigResolver.PublishConfigResolution resolution = RepositoryPublishConfigResolver.resolve(
                collectConfigSource(source),
                List.of(),
                repos.configValueRepository().findAll()
        );
        List<RepositoryPublishConfigCandidate> candidates = resolution.items().stream()
                .map(item -> new RepositoryPublishConfigCandidate(item.key(), item.label(), item.secret()))
                .toList();
        return new RepositoryWebhookPublishPreview(
                candidates,
                resolution.missingKeys(),
                dependencies,
                dependencyDrafts
        );
    }

    private WebhookDefinition requireSource(String sourceId) {
        return repos.webhookRepository().findById(NormalizeUtils.normalize(sourceId, "sourceId 不能为空"))
                .orElseThrow(() -> new IllegalArgumentException("Webhook不存在: " + sourceId));
    }

    private void assertUpstreamPublishSafe(WebhookDefinition source,
                                           RepositoryDefinition repository,
                                           RepositoryLocalAsset binding) {
        RepositoryWebhookDetail detail = catalog.getRepositoryWebhook(repository.getId(), binding.getUpstreamAssetId());
        ToolSourceState state = catalog.resolveWebhookState(repository, detail);
        String localDigest = catalog.computeWebhookLocalDigest(source);
        UpstreamSyncState syncState = UpstreamSyncService.resolveSyncState(binding, localDigest, state);
        if (syncState == UpstreamSyncState.REMOTE_CHANGES || syncState == UpstreamSyncState.DIVERGED) {
            throw new UpstreamConflictException(source.getId(), binding.getRepositoryId(), binding.getUpstreamAssetId());
        }
    }

    private void updateTrackedLocalAsset(RepositoryLocalAsset binding, RepositoryWebhookDetail detail) {
        ToolSourceState state = catalog.resolveWebhookState(catalog.getRepository(binding.getRepositoryId()), detail);
        repos.repositoryLocalAssetRepository().save(binding
                .setVersion(detail.descriptor().version())
                .setLatestVersion(detail.descriptor().version())
                .setSourcePath(state.path())
                .setBaseCommit(state.commit())
                .setBaseDigest(state.digest())
                .setLastSyncedAt(LocalDateTime.now())
                .setUpdatedAt(LocalDateTime.now()));
    }

    private List<ConfigTemplateItem> buildConfigTemplates(WebhookDefinition source,
                                                          List<RepositoryPublishConfigItem> configItems) {
        RepositoryPublishConfigResolver.PublishConfigResolution resolution = RepositoryPublishConfigResolver.resolve(
                collectConfigSource(source),
                List.of(),
                repos.configValueRepository().findAll()
        );
        return RepositoryPublishConfigResolver.buildTemplates(resolution, configItems).stream()
                .sorted(java.util.Comparator.comparing(ConfigTemplateItem::key))
                .toList();
    }

    private String collectConfigSource(WebhookDefinition source) {
        StringBuilder builder = new StringBuilder();
        builder.append(NormalizeUtils.normalizeNullable(source.getWebhookScriptId())).append('\n');
        return builder.toString();
    }

    private WebhookFile buildWebhookFile(WebhookDefinition source,
                                                 RepositoryWebhookPublishRequest request,
                                                 String webhookId,
                                                 List<ConfigTemplateItem> configTemplates,
                                                 List<ScriptDependency> scriptDependencies) {
        WebhookFile initial = new WebhookFile(
                RepositoryIndexUtils.DEFAULT_VERSION,
                webhookId,
                NormalizeUtils.normalizeOrDefault(request.displayName(), source.getName()),
                NormalizeUtils.normalize(request.version(), "version 不能为空"),
                NormalizeUtils.normalizeNullable(source.getDescription()),
                NormalizeUtils.normalizeNullable(request.releaseNotes()),
                NormalizeUtils.normalizeNullable(request.owner()),
                NormalizeUtils.nullSafeList(request.tags()),
                null,
                source.getTransport(),
                source.getWebhookScriptId(),
                source.getSampleRequest(),
                scriptDependencies,
                configTemplates.isEmpty() ? null : WEBHOOK_CONFIG_TEMPLATE_FILE
        );
        String digest = RepositoryVersionUtils.sha256(catalog.jsonCodec().write(initial));
        return new WebhookFile(
                initial.schemaVersion(),
                initial.webhookId(),
                initial.displayName(),
                initial.version(),
                initial.description(),
                initial.releaseNotes(),
                initial.owner(),
                initial.tags(),
                digest,
                initial.transport(),
                initial.webhookScriptId(),
                initial.sampleRequest(),
                initial.scriptDependencies(),
                initial.configTemplatePath()
        );
    }

    private void updateWorkingCopySourceMetadata(WebhookDefinition source,
                                                 RepositoryDefinition repository,
                                                 RepositoryWebhookDetail detail) {
        ToolSourceState state = catalog.resolveWebhookState(repository, detail);
        WebhookDefinition updated = repos.webhookRepository().findById(source.getId())
                .orElse(source);
        updated.setRepositoryVersion(detail.descriptor().version())
                .setSourcePath(state.path())
                .setSourceCommit(state.commit())
                .setSourceDigest(state.digest())
                .setSourceSyncedAt(LocalDateTime.now())
                .setDirty(false);
        repos.webhookRepository().save(updated);
    }
}
