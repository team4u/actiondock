package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.exception.UpstreamConflictException;
import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventSourceScope;
import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.EventTriggerScope;
import org.team4u.actiondock.domain.model.ProcessorDefinition;
import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.ScriptStatus;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.domain.model.UpstreamBinding;
import org.team4u.actiondock.shared.NormalizeUtils;

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

    static boolean isRemoteChanged(UpstreamBinding binding, ToolSourceState state) {
        return !Objects.equals(binding.getBaseCommit(), state.commit())
                || !Objects.equals(binding.getBaseDigest(), state.digest());
    }

    static boolean isLocalChanged(UpstreamBinding binding, String localDigest) {
        return !Objects.equals(binding.getBaseDigest(), localDigest);
    }

    static UpstreamSyncState resolveSyncState(UpstreamBinding binding, String localDigest, ToolSourceState remoteState) {
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
        if (repos.upstreamBindingRepository().findByUpstreamAsset(UpstreamAssetType.SCRIPT, repositoryId, toolId).isPresent()) {
            throw new IllegalArgumentException("上游脚本已存在工作副本: " + repositoryId + "/" + toolId);
        }
        RepositoryToolDetail detail = catalog.getRepositoryTool(repositoryId, toolId);
        String scriptId = NormalizeUtils.normalizeOrDefault(request == null ? null : request.id(), detail.descriptor().toolId());
        if (repos.scriptRepository().findById(scriptId).isPresent()) {
            throw new IllegalArgumentException("脚本 ID 已存在，请指定其他工作副本 ID: " + scriptId);
        }
        removeInstalledTool(detail.descriptor().installedScriptId());
        ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        ScriptDefinition saved = repos.scriptRepository().save(buildWorkingCopyScript(scriptId, null, detail));
        repos.upstreamBindingRepository().save(newBinding(
                UpstreamAssetType.SCRIPT,
                saved.getId(),
                repositoryId,
                toolId,
                detail.descriptor().version(),
                state
        ));
        return saved;
    }

    UpstreamStatus getScriptUpstreamStatus(String scriptId) {
        ScriptDefinition script = services.scriptApplicationService().get(scriptId);
        UpstreamBinding binding = requireBinding(UpstreamAssetType.SCRIPT, script.getId());
        RepositoryDefinition repository = catalog.getRepository(binding.getRepositoryId());
        RepositoryToolDetail detail = catalog.getRepositoryTool(repository.getId(), binding.getUpstreamAssetId());
        ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        String localDigest = catalog.computeWorkingCopyLocalDigest(script);
        UpstreamSyncState syncState = resolveSyncState(binding, localDigest, state);
        return new UpstreamStatus(
                script.getId(),
                binding.getRepositoryId(),
                binding.getUpstreamAssetId(),
                binding.getUpstreamVersion(),
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
        UpstreamBinding binding = requireBinding(UpstreamAssetType.SCRIPT, script.getId());
        RepositoryDefinition repository = catalog.getRepository(binding.getRepositoryId());
        catalog.syncRepository(repository.getId());
        RepositoryToolDetail detail = catalog.getRepositoryTool(repository.getId(), binding.getUpstreamAssetId());
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
        repos.upstreamBindingRepository().save(updateBinding(binding, detail.descriptor().version(), state));
        return saved;
    }

    void detachScript(String scriptId) {
        UpstreamBinding binding = requireBinding(UpstreamAssetType.SCRIPT, scriptId);
        repos.upstreamBindingRepository().deleteById(binding.getId());
    }

    ScriptDefinition buildBaseScriptDefinition(String scriptId, RepositoryToolDetail detail, String repositoryId) {
        RepositoryCatalogTypes.RepositoryToolDescriptor d = detail.descriptor();
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
                .setStatus(ScriptStatus.PUBLISHED)
                .setRepositoryId(repositoryId)
                .setRepositoryToolId(d.toolId())
                .setRepositoryVersion(d.version())
                .setOwner(d.owner())
                .setDescription(d.description())
                .setTags(d.tags())
                .setScriptDependencies(d.scriptDependencies())
                .setPluginDependencies(d.pluginDependencies());
        definition.setPublishedSnapshot(definition.snapshotCurrent());
        return definition;
    }

    static ScriptDefinition applyLifecycle(ScriptDefinition def, ScriptDefinition existing,
                                           ScriptScope scope, boolean editable, LocalDateTime now) {
        return def.setScope(scope)
                .setEditable(editable)
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now);
    }

    private ScriptDefinition buildWorkingCopyScript(String scriptId, ScriptDefinition existing, RepositoryToolDetail detail) {
        LocalDateTime now = LocalDateTime.now();
        return applyLifecycle(buildBaseScriptDefinition(scriptId, detail, detail.descriptor().repositoryId()),
                existing, ScriptScope.PERSONAL, true, now)
                .setVersion(existing == null ? 1 : existing.getVersion())
                .setDirty(false);
    }

    EventSourceDefinition createEventSourceWorkingCopy(String repositoryId,
                                                       String eventSourceId,
                                                       WorkingCopyRequest request) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        ensureTrackableRepository(repository);
        if (repos.upstreamBindingRepository().findByUpstreamAsset(UpstreamAssetType.EVENT_SOURCE, repositoryId, eventSourceId).isPresent()) {
            throw new IllegalArgumentException("上游事件源已存在工作副本: " + repositoryId + "/" + eventSourceId);
        }
        RepositoryEventSourceDetail detail = catalog.getRepositoryEventSource(repositoryId, eventSourceId);
        String sourceId = NormalizeUtils.normalizeOrDefault(request == null ? null : request.id(), detail.descriptor().eventSourceId());
        if (repos.eventSourceRepository().findById(sourceId).isPresent()) {
            throw new IllegalArgumentException("事件源 ID 已存在，请指定其他工作副本 ID: " + sourceId);
        }
        removeInstalledEventSource(detail.descriptor().installedSourceId());
        ToolSourceState state = catalog.resolveEventSourceState(repository, detail);
        EventSourceDefinition saved = saveWorkingCopyEventSource(sourceId, null, detail);
        repos.upstreamBindingRepository().save(newBinding(
                UpstreamAssetType.EVENT_SOURCE,
                saved.getId(),
                repositoryId,
                eventSourceId,
                detail.descriptor().version(),
                state
        ));
        return saved;
    }

    UpstreamStatus getEventSourceUpstreamStatus(String sourceId) {
        EventSourceDefinition source = repos.eventSourceRepository().findById(sourceId)
                .orElseThrow(() -> new IllegalArgumentException("事件源不存在: " + sourceId));
        UpstreamBinding binding = requireBinding(UpstreamAssetType.EVENT_SOURCE, source.getId());
        RepositoryDefinition repository = catalog.getRepository(binding.getRepositoryId());
        RepositoryEventSourceDetail detail = catalog.getRepositoryEventSource(repository.getId(), binding.getUpstreamAssetId());
        ToolSourceState state = catalog.resolveEventSourceState(repository, detail);
        String localDigest = catalog.computeEventSourceLocalDigest(source, repos.eventTriggerRepository().findBySourceId(sourceId));
        UpstreamSyncState syncState = resolveSyncState(binding, localDigest, state);
        return new UpstreamStatus(
                source.getId(),
                binding.getRepositoryId(),
                binding.getUpstreamAssetId(),
                binding.getUpstreamVersion(),
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

    EventSourceDefinition pullEventSource(String sourceId, boolean force) {
        EventSourceDefinition source = repos.eventSourceRepository().findById(sourceId)
                .orElseThrow(() -> new IllegalArgumentException("事件源不存在: " + sourceId));
        UpstreamBinding binding = requireBinding(UpstreamAssetType.EVENT_SOURCE, source.getId());
        RepositoryDefinition repository = catalog.getRepository(binding.getRepositoryId());
        catalog.syncRepository(repository.getId());
        RepositoryEventSourceDetail detail = catalog.getRepositoryEventSource(repository.getId(), binding.getUpstreamAssetId());
        ToolSourceState state = catalog.resolveEventSourceState(repository, detail);
        String localDigest = catalog.computeEventSourceLocalDigest(source, repos.eventTriggerRepository().findBySourceId(sourceId));
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
        EventSourceDefinition saved = saveWorkingCopyEventSource(source.getId(), source, detail);
        repos.upstreamBindingRepository().save(updateBinding(binding, detail.descriptor().version(), state));
        return saved;
    }

    void detachEventSource(String sourceId) {
        UpstreamBinding binding = requireBinding(UpstreamAssetType.EVENT_SOURCE, sourceId);
        repos.upstreamBindingRepository().deleteById(binding.getId());
    }

    private EventSourceDefinition saveWorkingCopyEventSource(String sourceId,
                                                            EventSourceDefinition existing,
                                                            RepositoryEventSourceDetail detail) {
        EventSourceDefinition source = buildWorkingCopyEventSource(sourceId, existing, detail);
        repos.eventSourceRepository().save(source);
        syncWorkingCopyTriggers(source, detail, existing == null ? List.of() : repos.eventTriggerRepository().findBySourceId(existing.getId()));
        return repos.eventSourceRepository().findById(source.getId()).orElse(source);
    }

    private EventSourceDefinition buildWorkingCopyEventSource(String sourceId,
                                                             EventSourceDefinition existing,
                                                             RepositoryEventSourceDetail detail) {
        LocalDateTime now = LocalDateTime.now();
        RepositoryEventSourceDescriptor descriptor = detail.descriptor();
        return new EventSourceDefinition()
                .setId(sourceId)
                .setKey(sourceId)
                .setName(descriptor.displayName())
                .setDescription(detail.eventSource().description())
                .setScope(EventSourceScope.PERSONAL)
                .setRepositoryId(descriptor.repositoryId())
                .setRepositoryEventSourceId(descriptor.eventSourceId())
                .setRepositoryVersion(descriptor.version())
                .setTransport(detail.eventSource().transport())
                .setAuth(detail.eventSource().auth())
                .setNormalizationProcessor(detail.eventSource().normalizationProcessor())
                .setWebhookResponse(detail.eventSource().webhookResponse())
                .setSampleContext(detail.eventSource().sampleContext())
                .setEditable(true)
                .setEnabled(existing == null ? true : existing.isEnabled())
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now)
                .setLastReceivedAt(existing == null ? null : existing.getLastReceivedAt())
                .setDirty(false);
    }

    private void syncWorkingCopyTriggers(EventSourceDefinition source,
                                         RepositoryEventSourceDetail detail,
                                         List<EventTrigger> existingTriggers) {
        LocalDateTime now = LocalDateTime.now();
        Map<String, EventTrigger> existingByTemplateId = existingTriggers.stream()
                .filter(trigger -> trigger.getRepositoryTriggerId() != null)
                .collect(java.util.stream.Collectors.toMap(EventTrigger::getRepositoryTriggerId, java.util.function.Function.identity(), (a, b) -> a, java.util.LinkedHashMap::new));
        for (RepositoryCatalogTypes.EventTriggerTemplateItem template : detail.triggerTemplate()) {
            EventTrigger existing = existingByTemplateId.get(template.id());
            String targetScriptId = resolveWorkingCopyTriggerTargetScriptId(source.getRepositoryId(), template.targetScriptDependency(), existing);
            EventTrigger trigger = new EventTrigger()
                    .setId(existing == null ? source.getId() + "." + template.id() : existing.getId())
                    .setName(template.name())
                    .setDescription(template.description())
                    .setScope(EventTriggerScope.PERSONAL)
                    .setRepositoryId(source.getRepositoryId())
                    .setRepositoryEventSourceId(source.getRepositoryEventSourceId())
                    .setRepositoryVersion(source.getRepositoryVersion())
                    .setRepositoryTriggerId(template.id())
                    .setEditable(true)
                    .setEnabled(existing == null ? template.enabledByDefault() : existing.isEnabled())
                    .setSourceId(source.getId())
                    .setTargetScriptId(targetScriptId)
                    .setFilterProcessor(normalizeProcessor(template.filterProcessor()))
                    .setIdempotencyProcessor(normalizeProcessor(template.idempotencyProcessor()))
                    .setInputProcessor(normalizeProcessor(template.inputProcessor()))
                    .setSubmitMode(template.submitMode() == null ? null : org.team4u.actiondock.domain.model.SubmitMode.valueOf(template.submitMode()))
                    .setResponseView(template.responseView())
                    .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                    .setUpdatedAt(now)
                    .setLastEventId(existing == null ? null : existing.getLastEventId())
                    .setLastTriggeredAt(existing == null ? null : existing.getLastTriggeredAt())
                    .setLastExecutionId(existing == null ? null : existing.getLastExecutionId())
                    .setLastExecutionStatus(existing == null ? null : existing.getLastExecutionStatus());
            repos.eventTriggerRepository().save(trigger);
        }
        for (EventTrigger existing : existingByTemplateId.values()) {
            boolean stillPresent = detail.triggerTemplate().stream().anyMatch(template -> template.id().equals(existing.getRepositoryTriggerId()));
            if (!stillPresent) {
                repos.eventTriggerRepository().deleteById(existing.getId());
            }
        }
    }

    private void ensureTrackableRepository(RepositoryDefinition repository) {
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            throw new IllegalArgumentException("HTTP 仓库不支持创建工作副本");
        }
    }

    private void removeInstalledTool(String installedScriptId) {
        if (repos.repositoryToolInstallationRepository().findByToolId(installedScriptId).isEmpty()) {
            return;
        }
        repos.scriptScheduleRepository().findAll().stream()
                .filter(item -> installedScriptId.equals(item.getRepositoryToolId()))
                .map(org.team4u.actiondock.domain.model.ScriptSchedule::getId)
                .toList()
                .forEach(repos.scriptScheduleRepository()::deleteById);
        repos.scriptRepository().deleteById(installedScriptId);
        repos.repositoryToolInstallationRepository().deleteByToolId(installedScriptId);
    }

    private void removeInstalledEventSource(String installedSourceId) {
        if (repos.repositoryEventSourceInstallationRepository().findBySourceId(installedSourceId).isEmpty()) {
            return;
        }
        repos.eventTriggerRepository().findBySourceId(installedSourceId).stream()
                .map(EventTrigger::getId)
                .toList()
                .forEach(repos.eventTriggerRepository()::deleteById);
        repos.eventSourceRepository().deleteById(installedSourceId);
        repos.repositoryEventSourceInstallationRepository().deleteBySourceId(installedSourceId);
    }

    private UpstreamBinding newBinding(UpstreamAssetType assetType,
                                       String localAssetId,
                                       String repositoryId,
                                       String upstreamAssetId,
                                       String upstreamVersion,
                                       ToolSourceState state) {
        LocalDateTime now = LocalDateTime.now();
        return new UpstreamBinding()
                .setId(UUID.randomUUID().toString())
                .setAssetType(assetType)
                .setLocalAssetId(localAssetId)
                .setRepositoryId(repositoryId)
                .setUpstreamAssetId(upstreamAssetId)
                .setUpstreamVersion(upstreamVersion)
                .setSourcePath(state.path())
                .setBaseCommit(state.commit())
                .setBaseDigest(state.digest())
                .setLastSyncedAt(now)
                .setCreatedAt(now)
                .setUpdatedAt(now);
    }

    private UpstreamBinding updateBinding(UpstreamBinding binding, String upstreamVersion, ToolSourceState state) {
        return binding
                .setUpstreamVersion(upstreamVersion)
                .setSourcePath(state.path())
                .setBaseCommit(state.commit())
                .setBaseDigest(state.digest())
                .setLastSyncedAt(LocalDateTime.now())
                .setUpdatedAt(LocalDateTime.now());
    }

    private UpstreamBinding requireBinding(UpstreamAssetType assetType, String localAssetId) {
        return repos.upstreamBindingRepository()
                .findByLocalAsset(assetType, localAssetId)
                .orElseThrow(() -> new IllegalArgumentException("工作副本未绑定上游: " + localAssetId));
    }

    private String resolveWorkingCopyTriggerTargetScriptId(String repositoryId,
                                                          org.team4u.actiondock.domain.model.ScriptDependency dependency,
                                                          EventTrigger existing) {
        if (existing != null && !NormalizeUtils.isBlank(existing.getTargetScriptId())) {
            return existing.getTargetScriptId();
        }
        return repos.scriptRepository().findInstalledByRepositorySource(repositoryId, dependency.getToolId())
                .map(ScriptDefinition::getId)
                .orElse(repositoryId + "." + dependency.getToolId());
    }

    private static ProcessorDefinition normalizeProcessor(ProcessorDefinition processor) {
        return processor == null || processor.isEmpty() ? null : processor;
    }
}
