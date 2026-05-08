package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventSourceScope;
import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.EventTriggerScope;
import org.team4u.actiondock.domain.model.ProcessorDefinition;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.ScriptStatus;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.exception.DevelopmentConflictException;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 仓库工具开发同步服务，负责将远程仓库工具拉取到本地开发脚本。
 * <p>
 * 管理开发脚本的创建、状态查询和远程变更拉取，包含独立的状态机
 * （{@link DevelopmentSyncState}）来处理本地/远程变更冲突检测。
 *
 * @author jay.wu
 */
class DevelopmentSyncService {

    private final RepositoryCatalogService catalog;
    private final RepositoryCatalogService.Repositories repos;
    private final RepositoryCatalogService.ApplicationServices services;

    DevelopmentSyncService(RepositoryCatalogService catalog,
                           RepositoryCatalogService.Repositories repos,
                           RepositoryCatalogService.ApplicationServices services) {
        this.catalog = catalog;
        this.repos = repos;
        this.services = services;
    }

    // ---- 开发同步纯逻辑方法 ----

    static boolean isRemoteChanged(ScriptDefinition script, ToolSourceState state) {
        return isRemoteChanged(script.getSourceCommit(), script.getSourceDigest(), state);
    }

    static boolean isLocalChanged(ScriptDefinition script, String localDigest) {
        return isLocalChanged(script.getSourceDigest(), localDigest);
    }

    static boolean isRemoteChanged(String localCommit, String localDigest, ToolSourceState state) {
        return !Objects.equals(localCommit, state.commit())
                || !Objects.equals(localDigest, state.digest());
    }

    static boolean isLocalChanged(String baseDigest, String localDigest) {
        return !Objects.equals(baseDigest, localDigest);
    }

    static DevelopmentSyncState resolveDevelopmentSyncState(ScriptDefinition script, String localDigest, ToolSourceState remoteState) {
        boolean localChanged = isLocalChanged(script, localDigest);
        boolean remoteChanged = isRemoteChanged(script, remoteState);
        if (localChanged && remoteChanged) {
            return DevelopmentSyncState.DIVERGED;
        }
        if (localChanged) {
            return DevelopmentSyncState.LOCAL_CHANGES;
        }
        if (remoteChanged) {
            return DevelopmentSyncState.REMOTE_CHANGES;
        }
        return DevelopmentSyncState.SYNCED;
    }

    static DevelopmentSyncState resolveEventSourceSyncState(EventSourceDefinition eventSource, String localDigest, ToolSourceState remoteState) {
        boolean localChanged = isLocalChanged(eventSource.getSourceDigest(), localDigest);
        boolean remoteChanged = isRemoteChanged(eventSource.getSourceCommit(), eventSource.getSourceDigest(), remoteState);
        if (localChanged && remoteChanged) {
            return DevelopmentSyncState.DIVERGED;
        }
        if (localChanged) {
            return DevelopmentSyncState.LOCAL_CHANGES;
        }
        if (remoteChanged) {
            return DevelopmentSyncState.REMOTE_CHANGES;
        }
        return DevelopmentSyncState.SYNCED;
    }

    static void ensureDevelopmentRepository(RepositoryDefinition repository) {
        if (!REPO_USAGE_DEVELOPMENT.equalsIgnoreCase(repository.getUsage())) {
            throw new IllegalArgumentException("仓库不是开发仓库: " + repository.getId());
        }
        if (REPO_TYPE_HTTP.equals(repository.getType())) {
            throw new IllegalArgumentException("HTTP 仓库不支持开发同步");
        }
    }

    static void ensureDevelopmentScript(ScriptDefinition script) {
        if (script.getScope() != ScriptScope.DEVELOPMENT) {
            throw new IllegalArgumentException("脚本不是开发仓库脚本: " + script.getId());
        }
        NormalizeUtils.normalize(script.getRepositoryId(), "开发脚本缺少来源仓库");
        NormalizeUtils.normalize(script.getRepositoryToolId(), "开发脚本缺少来源工具");
    }

    static void ensureDevelopmentEventSource(EventSourceDefinition source) {
        if (source.getScope() != EventSourceScope.DEVELOPMENT) {
            throw new IllegalArgumentException("事件源不是开发仓库事件源: " + source.getId());
        }
        NormalizeUtils.normalize(source.getRepositoryId(), "开发事件源缺少来源仓库");
        NormalizeUtils.normalize(source.getRepositoryEventSourceId(), "开发事件源缺少来源事件源");
    }

    ScriptDefinition syncToolForDevelopment(String repositoryId, String toolId, DevelopmentSyncRequest request) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        ensureDevelopmentRepository(repository);
        RepositoryToolDetail detail = catalog.getRepositoryTool(repositoryId, toolId);
        String scriptId = NormalizeUtils.normalizeOrDefault(request == null ? null : request.scriptId(), detail.descriptor().toolId());
        ScriptDefinition existing = repos.scriptRepository().findById(scriptId).orElse(null);
        if (existing != null && existing.getScope() != ScriptScope.DEVELOPMENT) {
            throw new IllegalArgumentException("脚本 ID 已存在，请指定其他开发脚本 ID: " + scriptId);
        }
        if (existing != null) {
            return pullDevelopmentScript(scriptId, false);
        }
        ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        return saveDevelopmentScript(scriptId, existing, detail, state);
    }

    DevelopmentStatus getDevelopmentStatus(String scriptId) {
        ScriptDefinition script = services.scriptApplicationService().get(scriptId);
        ensureDevelopmentScript(script);
        RepositoryDefinition repository = catalog.getRepository(script.getRepositoryId());
        RepositoryToolDetail detail = catalog.getRepositoryTool(repository.getId(), script.getRepositoryToolId());
        ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        String localDigest = catalog.computeDevelopmentLocalDigest(script);
        DevelopmentSyncState syncState = resolveDevelopmentSyncState(script, localDigest, state);
        boolean remoteChanged = isRemoteChanged(script, state);
        boolean dirty = isLocalChanged(script, localDigest);
        String remoteVersion = detail.descriptor().version();
        return new DevelopmentStatus(
                script.getId(),
                script.getRepositoryId(),
                script.getRepositoryToolId(),
                script.getRepositoryVersion(),
                script.getSourceCommit(),
                state.commit(),
                script.getSourceDigest(),
                localDigest,
                state.digest(),
                dirty,
                remoteChanged,
                syncState.name(),
                remoteVersion,
                script.getSourceSyncedAt()
        );
    }

    ScriptDefinition pullDevelopmentScript(String scriptId, boolean force) {
        ScriptDefinition script = services.scriptApplicationService().get(scriptId);
        ensureDevelopmentScript(script);
        RepositoryDefinition repository = catalog.getRepository(script.getRepositoryId());
        catalog.syncRepository(repository.getId());
        RepositoryToolDetail detail = catalog.getRepositoryTool(repository.getId(), script.getRepositoryToolId());
        ToolSourceState state = catalog.resolveToolSourceState(repository, detail);
        String localDigest = catalog.computeDevelopmentLocalDigest(script);
        DevelopmentSyncState syncState = resolveDevelopmentSyncState(script, localDigest, state);
        if (syncState == DevelopmentSyncState.SYNCED) {
            return script;
        }
        if (syncState == DevelopmentSyncState.LOCAL_CHANGES && !force) {
            return script;
        }
        if (syncState == DevelopmentSyncState.DIVERGED && !force) {
            throw new DevelopmentConflictException(script.getId(), script.getRepositoryId(), script.getRepositoryToolId());
        }
        return saveDevelopmentScript(script.getId(), script, detail, state);
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

    private ScriptDefinition saveDevelopmentScript(String scriptId,
                                                   ScriptDefinition existing,
                                                   RepositoryToolDetail detail,
                                                   ToolSourceState state) {
        ScriptDefinition def = buildDevelopmentScriptDefinition(scriptId, existing, detail, state);
        return repos.scriptRepository().save(def);
    }

    private ScriptDefinition buildDevelopmentScriptDefinition(String scriptId,
                                                               ScriptDefinition existing,
                                                               RepositoryToolDetail detail,
                                                               ToolSourceState state) {
        LocalDateTime now = LocalDateTime.now();
        return applyLifecycle(buildBaseScriptDefinition(scriptId, detail, detail.descriptor().repositoryId()),
                existing, ScriptScope.DEVELOPMENT, true, now)
                .setVersion(existing == null ? 1 : existing.getVersion())
                .setSourcePath(state.path())
                .setSourceCommit(state.commit())
                .setSourceDigest(state.digest())
                .setSourceSyncedAt(now)
                .setDirty(false);
    }

    EventSourceDefinition syncEventSourceForDevelopment(String repositoryId,
                                                        String eventSourceId,
                                                        RepositoryCatalogTypes.DevelopmentSyncRequest request) {
        RepositoryDefinition repository = catalog.getRepository(repositoryId);
        ensureDevelopmentRepository(repository);
        RepositoryEventSourceDetail detail = catalog.getRepositoryEventSource(repositoryId, eventSourceId);
        String sourceId = NormalizeUtils.normalizeOrDefault(request == null ? null : request.scriptId(), detail.descriptor().eventSourceId());
        EventSourceDefinition existing = repos.eventSourceRepository().findById(sourceId).orElse(null);
        if (existing != null && existing.getScope() != EventSourceScope.DEVELOPMENT) {
            throw new IllegalArgumentException("事件源 ID 已存在，请指定其他开发事件源 ID: " + sourceId);
        }
        if (existing != null) {
            return pullDevelopmentEventSource(sourceId, false);
        }
        ToolSourceState state = catalog.resolveEventSourceState(repository, detail);
        return saveDevelopmentEventSource(sourceId, existing, detail, state);
    }

    DevelopmentStatus getEventSourceDevelopmentStatus(String sourceId) {
        EventSourceDefinition source = repos.eventSourceRepository().findById(sourceId)
                .orElseThrow(() -> new IllegalArgumentException("事件源不存在: " + sourceId));
        ensureDevelopmentEventSource(source);
        RepositoryDefinition repository = catalog.getRepository(source.getRepositoryId());
        RepositoryEventSourceDetail detail = catalog.getRepositoryEventSource(repository.getId(), source.getRepositoryEventSourceId());
        ToolSourceState state = catalog.resolveEventSourceState(repository, detail);
        List<EventTrigger> triggers = repos.eventTriggerRepository().findBySourceId(sourceId).stream()
                .filter(trigger -> trigger.getScope() == EventTriggerScope.DEVELOPMENT)
                .toList();
        String localDigest = catalog.computeEventSourceLocalDigest(source, triggers);
        DevelopmentSyncState syncState = resolveEventSourceSyncState(source, localDigest, state);
        return new DevelopmentStatus(
                source.getId(),
                source.getRepositoryId(),
                source.getRepositoryEventSourceId(),
                source.getRepositoryVersion(),
                source.getSourceCommit(),
                state.commit(),
                source.getSourceDigest(),
                localDigest,
                state.digest(),
                isLocalChanged(source.getSourceDigest(), localDigest),
                isRemoteChanged(source.getSourceCommit(), source.getSourceDigest(), state),
                syncState.name(),
                detail.descriptor().version(),
                source.getSourceSyncedAt()
        );
    }

    EventSourceDefinition pullDevelopmentEventSource(String sourceId, boolean force) {
        EventSourceDefinition source = repos.eventSourceRepository().findById(sourceId)
                .orElseThrow(() -> new IllegalArgumentException("事件源不存在: " + sourceId));
        ensureDevelopmentEventSource(source);
        RepositoryDefinition repository = catalog.getRepository(source.getRepositoryId());
        catalog.syncRepository(repository.getId());
        RepositoryEventSourceDetail detail = catalog.getRepositoryEventSource(repository.getId(), source.getRepositoryEventSourceId());
        ToolSourceState state = catalog.resolveEventSourceState(repository, detail);
        List<EventTrigger> triggers = repos.eventTriggerRepository().findBySourceId(sourceId).stream()
                .filter(trigger -> trigger.getScope() == EventTriggerScope.DEVELOPMENT)
                .toList();
        String localDigest = catalog.computeEventSourceLocalDigest(source, triggers);
        DevelopmentSyncState syncState = resolveEventSourceSyncState(source, localDigest, state);
        if (syncState == DevelopmentSyncState.SYNCED) {
            return source;
        }
        if (syncState == DevelopmentSyncState.LOCAL_CHANGES && !force) {
            return source;
        }
        if (syncState == DevelopmentSyncState.DIVERGED && !force) {
            throw new DevelopmentConflictException(source.getId(), source.getRepositoryId(), source.getRepositoryEventSourceId());
        }
        return saveDevelopmentEventSource(source.getId(), source, detail, state);
    }

    private EventSourceDefinition saveDevelopmentEventSource(String sourceId,
                                                             EventSourceDefinition existing,
                                                             RepositoryEventSourceDetail detail,
                                                             ToolSourceState state) {
        EventSourceDefinition source = buildDevelopmentEventSourceDefinition(sourceId, existing, detail, state);
        repos.eventSourceRepository().save(source);
        syncDevelopmentTriggers(source, detail, existing == null ? List.of() : repos.eventTriggerRepository().findBySourceId(existing.getId()));
        return repos.eventSourceRepository().findById(source.getId()).orElse(source);
    }

    private EventSourceDefinition buildDevelopmentEventSourceDefinition(String sourceId,
                                                                       EventSourceDefinition existing,
                                                                       RepositoryEventSourceDetail detail,
                                                                       ToolSourceState state) {
        LocalDateTime now = LocalDateTime.now();
        RepositoryEventSourceDescriptor descriptor = detail.descriptor();
        return new EventSourceDefinition()
                .setId(sourceId)
                .setKey(sourceId)
                .setName(descriptor.displayName())
                .setDescription(detail.eventSource().description())
                .setScope(EventSourceScope.DEVELOPMENT)
                .setRepositoryId(descriptor.repositoryId())
                .setRepositoryEventSourceId(descriptor.eventSourceId())
                .setRepositoryVersion(descriptor.version())
                .setTransport(detail.eventSource().transport())
                .setAuth(detail.eventSource().auth())
                .setNormalizationProcessor(detail.eventSource().normalizationProcessor())
                .setSampleContext(detail.eventSource().sampleContext())
                .setEditable(true)
                .setEnabled(existing == null ? true : existing.isEnabled())
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now)
                .setLastReceivedAt(existing == null ? null : existing.getLastReceivedAt())
                .setSourcePath(state.path())
                .setSourceCommit(state.commit())
                .setSourceDigest(state.digest())
                .setSourceSyncedAt(now)
                .setDirty(false);
    }

    private void syncDevelopmentTriggers(EventSourceDefinition source,
                                         RepositoryEventSourceDetail detail,
                                         List<EventTrigger> existingTriggers) {
        LocalDateTime now = LocalDateTime.now();
        Map<String, EventTrigger> existingByTemplateId = existingTriggers.stream()
                .filter(trigger -> trigger.getScope() == EventTriggerScope.DEVELOPMENT)
                .filter(trigger -> trigger.getRepositoryTriggerId() != null)
                .collect(java.util.stream.Collectors.toMap(EventTrigger::getRepositoryTriggerId, java.util.function.Function.identity(), (a, b) -> a, java.util.LinkedHashMap::new));
        for (RepositoryCatalogTypes.EventTriggerTemplateItem template : detail.triggerTemplate()) {
            EventTrigger existing = existingByTemplateId.get(template.id());
            String targetScriptId = resolveDevelopmentTriggerTargetScriptId(source.getRepositoryId(), template.targetScriptDependency(), existing);
            EventTrigger trigger = new EventTrigger()
                    .setId(existing == null ? source.getId() + "." + template.id() : existing.getId())
                    .setName(template.name())
                    .setDescription(template.description())
                    .setScope(EventTriggerScope.DEVELOPMENT)
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

    private String resolveDevelopmentTriggerTargetScriptId(String repositoryId,
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
