package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.exception.UpstreamConflictException;
import org.team4u.actiondock.domain.model.WebhookDefinition;
import org.team4u.actiondock.domain.model.WebhookScope;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.RepositoryLocalAssetMode;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.common.NormalizeUtils;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

class UpstreamSyncService {

    private final RepositoryCatalogService catalog;
    private final RepositoryCatalogService.Repositories repos;
    private final RepositoryCatalogService.ApplicationServices services;

    UpstreamSyncService(RepositoryCatalogService catalog,
                        RepositoryCatalogService.Repositories repos,
                        RepositoryCatalogService.ApplicationServices services) {
        this.catalog = catalog;
        this.repos = repos;
        this.services = services;
    }

    static boolean isRemoteChanged(RepositoryLocalAsset binding, ToolSourceState state) {
        return !Objects.equals(binding.getBaseCommit(), state.commit())
                || !Objects.equals(binding.getBaseDigest(), state.digest());
    }

    static boolean isLocalChanged(RepositoryLocalAsset binding, String localDigest) {
        return !Objects.equals(binding.getBaseDigest(), localDigest);
    }

    static UpstreamSyncState resolveSyncState(RepositoryLocalAsset binding, String localDigest, ToolSourceState remoteState) {
        boolean localChanged = isLocalChanged(binding, localDigest);
        boolean remoteChanged = isRemoteChanged(binding, remoteState);
        if (localChanged && remoteChanged) {
            return UpstreamSyncState.DIVERGED;
        }
        if (localChanged) {
            return UpstreamSyncState.LOCAL_CHANGES;
        }
        if (remoteChanged) {
            return UpstreamSyncState.REMOTE_CHANGES;
        }
        return UpstreamSyncState.SYNCED;
    }

    ScriptDefinition createToolWorkingCopy(String repositoryId, String toolId, WorkingCopyRequest request) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        ensureTrackableRepository(repository);
        if (repos.repositoryLocalAssetRepository().findByUpstreamAsset(UpstreamAssetType.SCRIPT, repositoryId, toolId).isPresent()) {
            throw new IllegalArgumentException("上游脚本已添加到本地: " + repositoryId + "/" + toolId);
        }
        RepositoryScriptDetail detail = catalog.getRepositoryScript(repositoryId, toolId);
        String scriptId = NormalizeUtils.normalizeOrDefault(request == null ? null : request.id(), detail.descriptor().scriptId());
        if (repos.scriptRepository().findById(scriptId).isPresent()) {
            throw new IllegalArgumentException("脚本 ID 已存在，请指定其他工作副本 ID: " + scriptId);
        }
        ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        LocalDateTime now = LocalDateTime.now();
        ScriptDefinition saved = repos.scriptRepository().save(buildWorkingCopyScript(scriptId, null, detail));
        syncTrackedSchedules(saved, detail.scheduleTemplate(), now);
        repos.repositoryLocalAssetRepository().save(newBinding(
                UpstreamAssetType.SCRIPT,
                saved.getId(),
                repositoryId,
                toolId,
                detail.descriptor().displayName(),
                detail.descriptor().version(),
                state
        ));
        return saved;
    }

    UpstreamStatus getScriptUpstreamStatus(String scriptId) {
        ScriptDefinition script = services.scriptApplicationService().get(scriptId);
        RepositoryLocalAsset binding = findTrackedBinding(UpstreamAssetType.SCRIPT, script.getId()).orElse(null);
        if (binding == null) {
            return null;
        }
        RepositoryDefinition repository = catalog.getRepository(binding.getRepositoryId());
        RepositoryScriptDetail detail = catalog.getRepositoryScript(repository.getId(), binding.getUpstreamAssetId());
        ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        String localDigest = catalog.computeWorkingCopyLocalDigest(script);
        UpstreamSyncState syncState = resolveSyncState(binding, localDigest, state);
        return new UpstreamStatus(
                script.getId(),
                binding.getRepositoryId(),
                binding.getUpstreamAssetId(),
                binding.getVersion(),
                binding.getBaseCommit(),
                state.commit(),
                binding.getBaseDigest(),
                localDigest,
                state.digest(),
                isLocalChanged(binding, localDigest),
                isRemoteChanged(binding, state),
                syncState.name(),
                detail.descriptor().version(),
                binding.getLastSyncedAt()
        );
    }

    ScriptDefinition pullScript(String scriptId, boolean force) {
        ScriptDefinition script = services.scriptApplicationService().get(scriptId);
        RepositoryLocalAsset binding = requireBinding(UpstreamAssetType.SCRIPT, script.getId());
        RepositoryDefinition repository = catalog.getRepository(binding.getRepositoryId());
        catalog.syncRepository(repository.getId());
        RepositoryScriptDetail detail = catalog.getRepositoryScript(repository.getId(), binding.getUpstreamAssetId());
        ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        String localDigest = catalog.computeWorkingCopyLocalDigest(script);
        UpstreamSyncState syncState = resolveSyncState(binding, localDigest, state);
        if (syncState == UpstreamSyncState.SYNCED) {
            return script;
        }
        if (syncState == UpstreamSyncState.LOCAL_CHANGES && !force) {
            return script;
        }
        if (syncState == UpstreamSyncState.DIVERGED && !force) {
            throw new UpstreamConflictException(script.getId(), binding.getRepositoryId(), binding.getUpstreamAssetId());
        }
        ScriptDefinition saved = repos.scriptRepository().save(buildWorkingCopyScript(script.getId(), script, detail));
        repos.repositoryLocalAssetRepository().save(updateBinding(binding, detail.descriptor().version(), state));
        return saved;
    }

    void detachScript(String scriptId) {
        RepositoryLocalAsset binding = requireBinding(UpstreamAssetType.SCRIPT, scriptId);
        repos.repositoryLocalAssetRepository().deleteById(binding.getId());
    }

    ScriptDefinition buildBaseScriptDefinition(String scriptId, RepositoryScriptDetail detail, String repositoryId) {
        RepositoryCatalogTypes.RepositoryScriptDescriptor d = detail.descriptor();
        ScriptPackaging packaging = ScriptPackaging.fromNullableName(d.packaging());
        Map<String, Object> inputSchema = catalog.readSchema(repositoryId, d.inputSchemaPath());
        Map<String, Object> outputSchema = catalog.readSchema(repositoryId, d.outputSchemaPath());
        ScriptDefinition definition = new ScriptDefinition()
                .setId(scriptId)
                .setName(d.displayName())
                .setType(ScriptType.valueOf(d.type()))
                .setPackaging(packaging)
                .setSource(detail.source())
                .setPythonRequirements(detail.pythonRequirements())
                .setInputSchema(inputSchema)
                .setOutputSchema(outputSchema)
                .setRepositoryId(repositoryId)
                .setRepositoryScriptId(d.scriptId())
                .setRepositoryVersion(d.version())
                .setOwner(d.owner())
                .setDescription(d.description())
                .setTags(d.tags())
                .setScriptDependencies(d.scriptDependencies())
                .setPluginDependencies(d.pluginDependencies());
        definition.setPublishedRevision(PublishedScriptRevision.fromDraft(
                definition,
                scriptId + ":published:" + definition.getVersion(),
                definition.getVersion(),
                LocalDateTime.now()
        ));
        return definition;
    }

    static ScriptDefinition applyLifecycle(ScriptDefinition def, ScriptDefinition existing,
                                           ScriptScope scope, boolean editable, LocalDateTime now) {
        return def.setScope(scope)
                .setEditable(editable)
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now);
    }

    private ScriptDefinition buildWorkingCopyScript(String scriptId, ScriptDefinition existing, RepositoryScriptDetail detail) {
        LocalDateTime now = LocalDateTime.now();
        return applyLifecycle(buildBaseScriptDefinition(scriptId, detail, detail.descriptor().repositoryId()),
                existing, ScriptScope.PERSONAL, true, now)
                .setVersion(existing == null ? 1 : existing.getVersion())
                .setDirty(false);
    }

    private void syncTrackedSchedules(ScriptDefinition definition,
                                      List<ScheduleTemplateItem> templates,
                                      LocalDateTime now) {
        if (NormalizeUtils.nullSafeList(templates).isEmpty()) {
            return;
        }
        for (ScheduleTemplateItem template : templates) {
            ScriptSchedule schedule = new ScriptSchedule()
                    .setId(UUID.randomUUID().toString())
                    .setScriptId(definition.getId())
                    .setName(template.name())
                    .setCronExpression(template.cronExpression())
                    .setInput(template.input() == null ? Map.of() : template.input())
                    .setEnabled(false)
                    .setEditable(true)
                    .setRepositoryId(definition.getRepositoryId())
                    .setRepositoryScriptId(definition.getId())
                    .setRepositoryVersion(definition.getRepositoryVersion())
                    .setCreatedAt(now)
                    .setUpdatedAt(now);
            repos.scriptScheduleRepository().save(schedule);
        }
    }

    WebhookDefinition createWebhookWorkingCopy(String repositoryId,
                                                       String webhookId,
                                                       WorkingCopyRequest request) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        ensureTrackableRepository(repository);
        if (repos.repositoryLocalAssetRepository().findByUpstreamAsset(UpstreamAssetType.WEBHOOK, repositoryId, webhookId).isPresent()) {
            throw new IllegalArgumentException("上游Webhook已添加到本地: " + repositoryId + "/" + webhookId);
        }
        RepositoryWebhookDetail detail = catalog.getRepositoryWebhook(repositoryId, webhookId);
        String sourceId = NormalizeUtils.normalizeOrDefault(request == null ? null : request.id(), detail.descriptor().webhookId());
        if (repos.webhookRepository().findById(sourceId).isPresent()) {
            throw new IllegalArgumentException("Webhook ID 已存在，请指定其他工作副本 ID: " + sourceId);
        }
        ToolSourceState state = catalog.resolveWebhookState(repository, detail);
        WebhookDefinition saved = saveWorkingCopyWebhook(sourceId, null, detail);
        repos.repositoryLocalAssetRepository().save(newBinding(
                UpstreamAssetType.WEBHOOK,
                saved.getId(),
                repositoryId,
                webhookId,
                detail.descriptor().displayName(),
                detail.descriptor().version(),
                state
        ));
        return saved;
    }

    UpstreamStatus getWebhookUpstreamStatus(String sourceId) {
        WebhookDefinition source = repos.webhookRepository().findById(sourceId)
                .orElseThrow(() -> new IllegalArgumentException("Webhook不存在: " + sourceId));
        RepositoryLocalAsset binding = findTrackedBinding(UpstreamAssetType.WEBHOOK, source.getId()).orElse(null);
        if (binding == null) {
            return null;
        }
        RepositoryDefinition repository = catalog.getRepository(binding.getRepositoryId());
        RepositoryWebhookDetail detail = catalog.getRepositoryWebhook(repository.getId(), binding.getUpstreamAssetId());
        ToolSourceState state = catalog.resolveWebhookState(repository, detail);
        String localDigest = catalog.computeWebhookLocalDigest(source);
        UpstreamSyncState syncState = resolveSyncState(binding, localDigest, state);
        return new UpstreamStatus(
                source.getId(),
                binding.getRepositoryId(),
                binding.getUpstreamAssetId(),
                binding.getVersion(),
                binding.getBaseCommit(),
                state.commit(),
                binding.getBaseDigest(),
                localDigest,
                state.digest(),
                isLocalChanged(binding, localDigest),
                isRemoteChanged(binding, state),
                syncState.name(),
                detail.descriptor().version(),
                binding.getLastSyncedAt()
        );
    }

    WebhookDefinition pullWebhook(String sourceId, boolean force) {
        WebhookDefinition source = repos.webhookRepository().findById(sourceId)
                .orElseThrow(() -> new IllegalArgumentException("Webhook不存在: " + sourceId));
        RepositoryLocalAsset binding = requireBinding(UpstreamAssetType.WEBHOOK, source.getId());
        RepositoryDefinition repository = catalog.getRepository(binding.getRepositoryId());
        catalog.syncRepository(repository.getId());
        RepositoryWebhookDetail detail = catalog.getRepositoryWebhook(repository.getId(), binding.getUpstreamAssetId());
        ToolSourceState state = catalog.resolveWebhookState(repository, detail);
        String localDigest = catalog.computeWebhookLocalDigest(source);
        UpstreamSyncState syncState = resolveSyncState(binding, localDigest, state);
        if (syncState == UpstreamSyncState.SYNCED) {
            return source;
        }
        if (syncState == UpstreamSyncState.LOCAL_CHANGES && !force) {
            return source;
        }
        if (syncState == UpstreamSyncState.DIVERGED && !force) {
            throw new UpstreamConflictException(source.getId(), binding.getRepositoryId(), binding.getUpstreamAssetId());
        }
        WebhookDefinition saved = saveWorkingCopyWebhook(source.getId(), source, detail);
        repos.repositoryLocalAssetRepository().save(updateBinding(binding, detail.descriptor().version(), state));
        return saved;
    }

    void detachWebhook(String sourceId) {
        RepositoryLocalAsset binding = requireBinding(UpstreamAssetType.WEBHOOK, sourceId);
        repos.repositoryLocalAssetRepository().deleteById(binding.getId());
    }

    private WebhookDefinition saveWorkingCopyWebhook(String sourceId,
                                                            WebhookDefinition existing,
                                                            RepositoryWebhookDetail detail) {
        WebhookDefinition source = buildWorkingCopyWebhook(sourceId, existing, detail);
        repos.webhookRepository().save(source);
        return repos.webhookRepository().findById(source.getId()).orElse(source);
    }

    private WebhookDefinition buildWorkingCopyWebhook(String sourceId,
                                                             WebhookDefinition existing,
                                                             RepositoryWebhookDetail detail) {
        LocalDateTime now = LocalDateTime.now();
        RepositoryWebhookDescriptor descriptor = detail.descriptor();
        return new WebhookDefinition()
                .setId(sourceId)
                .setKey(sourceId)
                .setName(descriptor.displayName())
                .setDescription(detail.webhook().description())
                .setScope(WebhookScope.PERSONAL)
                .setRepositoryId(descriptor.repositoryId())
                .setRepositoryWebhookId(descriptor.webhookId())
                .setRepositoryVersion(descriptor.version())
                .setTransport(detail.webhook().transport())
                .setWebhookScriptId(detail.webhook().webhookScriptId())
                .setSampleRequest(detail.webhook().sampleRequest())
                .setEditable(true)
                .setEnabled(existing == null ? true : existing.isEnabled())
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now)
                .setLastReceivedAt(existing == null ? null : existing.getLastReceivedAt())
                .setDirty(false);
    }


    private void ensureTrackableRepository(RepositoryDefinition repository) {
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            throw new IllegalArgumentException("HTTP 仓库不支持创建工作副本");
        }
    }

    private RepositoryLocalAsset newBinding(UpstreamAssetType assetType,
                                            String localAssetId,
                                            String repositoryId,
                                            String upstreamAssetId,
                                            String name,
                                            String upstreamVersion,
                                            ToolSourceState state) {
        LocalDateTime now = LocalDateTime.now();
        return new RepositoryLocalAsset()
                .setId(assetType.name() + ":TRACKED:" + localAssetId)
                .setAssetType(assetType)
                .setLocalAssetId(localAssetId)
                .setRepositoryId(repositoryId)
                .setUpstreamAssetId(upstreamAssetId)
                .setMode(RepositoryLocalAssetMode.TRACKED)
                .setVersion(upstreamVersion)
                .setLatestVersion(upstreamVersion)
                .setName(name)
                .setSourcePath(state.path())
                .setBaseCommit(state.commit())
                .setBaseDigest(state.digest())
                .setLastSyncedAt(now)
                .setCreatedAt(now)
                .setUpdatedAt(now);
    }

    private RepositoryLocalAsset updateBinding(RepositoryLocalAsset binding, String upstreamVersion, ToolSourceState state) {
        return binding
                .setVersion(upstreamVersion)
                .setLatestVersion(upstreamVersion)
                .setSourcePath(state.path())
                .setBaseCommit(state.commit())
                .setBaseDigest(state.digest())
                .setLastSyncedAt(LocalDateTime.now())
                .setUpdatedAt(LocalDateTime.now());
    }

    private RepositoryLocalAsset requireBinding(UpstreamAssetType assetType, String localAssetId) {
        return findTrackedBinding(assetType, localAssetId)
                .orElseThrow(() -> new IllegalArgumentException("工作副本未绑定上游: " + localAssetId));
    }

    private java.util.Optional<RepositoryLocalAsset> findTrackedBinding(UpstreamAssetType assetType, String localAssetId) {
        return repos.repositoryLocalAssetRepository()
                .findByLocalAsset(assetType, localAssetId)
                .filter(asset -> asset.getMode() == RepositoryLocalAssetMode.TRACKED);
    }
}
