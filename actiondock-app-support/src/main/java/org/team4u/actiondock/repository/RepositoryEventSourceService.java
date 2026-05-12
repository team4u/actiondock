package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventSourceScope;
import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.EventTriggerScope;
import org.team4u.actiondock.domain.model.ProcessorDefinition;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.RepositoryLocalAssetMode;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

public class RepositoryEventSourceService {

    private final RepositoryCatalogService catalog;
    private final RepositoryCatalogService.Repositories repos;
    private final UpstreamSyncService upstreamSync;
    private final EventSourceRepositoryPublisher publisher;
    private final RepositoryConfigTemplateSyncService configTemplateSyncService;
    private final RepositoryToolService repositoryToolService;

    public RepositoryEventSourceService(RepositoryCatalogService catalog,
                                        RepositoryCatalogService.Repositories repos,
                                        RepositoryConfigTemplateSyncService configTemplateSyncService,
                                        RepositoryToolService repositoryToolService) {
        this.catalog = catalog;
        this.repos = repos;
        this.configTemplateSyncService = configTemplateSyncService;
        this.repositoryToolService = repositoryToolService;
        this.upstreamSync = new UpstreamSyncService(catalog, repos, catalog.getServices());
        this.publisher = new EventSourceRepositoryPublisher(catalog, repos);
    }

    public RepositoryEventSourcePublishPreview previewPublish(RepositoryEventSourcePublishPreviewRequest request) {
        return publisher.preview(request);
    }

    public RepositoryEventSourceDescriptor publishEventSource(String repositoryId, RepositoryEventSourcePublishRequest request) {
        return publisher.publish(repositoryId, request);
    }

    public RepositoryLocalAsset addLocalAsset(String repositoryId,
                                             String eventSourceId,
                                             RepositoryLocalAssetRequest request) {
        RepositoryLocalAssetMode mode = parseMode(request == null ? null : request.mode());
        if (mode == RepositoryLocalAssetMode.TRACKED) {
            EventSourceDefinition source = upstreamSync.createEventSourceWorkingCopy(repositoryId, eventSourceId,
                    new WorkingCopyRequest(request == null ? null : request.localAssetId()));
            return repos.repositoryLocalAssetRepository()
                    .findByLocalAsset(UpstreamAssetType.EVENT_SOURCE, source.getId())
                    .orElseThrow(() -> new IllegalStateException("本地事件源资产记录未创建: " + source.getId()));
        }
        return installOrUpdate(repositoryId, eventSourceId,
                request == null ? ToolInstallationOptions.DEFAULT : request.toOptions(),
                false,
                new LinkedHashSet<>());
    }

    public RepositoryLocalAsset updateLocalAsset(String repositoryId,
                                                String eventSourceId,
                                                ToolInstallationOptions options) {
        return installOrUpdate(repositoryId, eventSourceId, options, true, new LinkedHashSet<>());
    }

    public UpstreamStatus getUpstreamStatus(String eventSourceId) {
        return upstreamSync.getEventSourceUpstreamStatus(eventSourceId);
    }

    public EventSourceDefinition pullUpstreamEventSource(String eventSourceId, boolean force) {
        return upstreamSync.pullEventSource(eventSourceId, force);
    }

    public void detachUpstream(String eventSourceId) {
        upstreamSync.detachEventSource(eventSourceId);
    }

    public void uninstallEventSource(String localAssetId) {
        EventSourceDefinition source = repos.eventSourceRepository().findById(localAssetId)
                .orElseThrow(() -> new IllegalArgumentException("本地事件源不存在: " + localAssetId));
        for (EventTrigger trigger : repos.eventTriggerRepository().findBySourceId(source.getId())) {
            repos.eventTriggerRepository().deleteById(trigger.getId());
        }
        repos.eventSourceRepository().deleteById(source.getId());
        repos.repositoryLocalAssetRepository()
                .findByLocalAsset(UpstreamAssetType.EVENT_SOURCE, localAssetId)
                .ifPresent(asset -> repos.repositoryLocalAssetRepository().deleteById(asset.getId()));
        configTemplateSyncService.removeManagedConfigTemplates(source.getRepositoryId(), source.getRepositoryEventSourceId());
    }

    private RepositoryLocalAsset installOrUpdate(String repositoryId,
                                                 String eventSourceId,
                                                 ToolInstallationOptions options,
                                                 boolean updateOnly,
                                                 LinkedHashSet<String> visiting) {
        String installationKey = repositoryId + ":" + eventSourceId;
        if (!visiting.add(installationKey)) {
            throw new IllegalStateException("检测到事件源循环依赖: " + String.join(" -> ", visiting) + " -> " + installationKey);
        }
        try {
            RepositoryEventSourceDetail detail = catalog.getRepositoryEventSource(repositoryId, eventSourceId);
            RepositoryLocalAsset existingAsset = repos.repositoryLocalAssetRepository()
                    .findByUpstreamAsset(UpstreamAssetType.EVENT_SOURCE, repositoryId, eventSourceId)
                    .orElse(null);
            if (existingAsset != null && existingAsset.getMode() != RepositoryLocalAssetMode.LOCKED) {
                throw new IllegalArgumentException("上游事件源已添加为可编辑跟踪资产，不能按只读资产更新: " + existingAsset.getLocalAssetId());
            }
            if (!updateOnly && existingAsset != null) {
                throw new IllegalArgumentException("上游事件源已添加到本地: " + existingAsset.getLocalAssetId());
            }
            if (updateOnly && existingAsset == null) {
                throw new IllegalArgumentException("事件源尚未添加为只读本地资产: " + repositoryId + "/" + eventSourceId);
            }
            String localAssetId = existingAsset == null ? repositoryId + "." + eventSourceId : existingAsset.getLocalAssetId();
            EventSourceDefinition existing = repos.eventSourceRepository().findById(localAssetId).orElse(null);
            if (updateOnly && existing == null) {
                throw new IllegalArgumentException("事件源尚未添加为只读本地资产: " + repositoryId + "/" + eventSourceId);
            }
            resolveScriptDependencies(detail, options, visiting);
            return persistInstallation(repositoryId, detail, localAssetId, existing);
        } finally {
            visiting.remove(installationKey);
        }
    }

    private void resolveScriptDependencies(RepositoryEventSourceDetail detail,
                                           ToolInstallationOptions options,
                                           LinkedHashSet<String> visiting) {
        for (ScriptDependency dependency : NormalizeUtils.nullSafeList(detail.descriptor().scriptDependencies())) {
            ScriptDefinition installed = repos.scriptRepository()
                    .findInstalledByRepositorySource(
                            NormalizeUtils.normalize(dependency.getRepositoryId(), "repositoryId 不能为空"),
                            NormalizeUtils.normalize(dependency.getToolId(), "toolId 不能为空"))
                    .orElse(null);
            if (installed != null && RepositoryVersionUtils.versionSatisfies(installed.getRepositoryVersion(), dependency.getVersionRange())) {
                continue;
            }
            if (!options.installScriptDependencies()) {
                throw new IllegalArgumentException("缺少事件源依赖脚本: " + dependency.getRepositoryId() + "/" + dependency.getToolId());
            }
            repositoryToolService.addLocalAsset(
                    dependency.getRepositoryId(),
                    dependency.getToolId(),
                    new RepositoryLocalAssetRequest("LOCKED", null, false, true, options.installPluginDependencies(), options.forcePluginUpgrade())
            );
        }
    }

    private RepositoryLocalAsset persistInstallation(String repositoryId,
                                                     RepositoryEventSourceDetail detail,
                                                     String localAssetId,
                                                     EventSourceDefinition existing) {
        LocalDateTime now = LocalDateTime.now();
        EventSourceDefinition source = buildLockedEventSource(detail, localAssetId, existing, now);
        repos.eventSourceRepository().save(source);
        syncInstalledTriggers(source, detail, now);
        configTemplateSyncService.syncConfigTemplates(repositoryId, detail.descriptor().eventSourceId(), detail.descriptor().version(), detail.configTemplate());
        return saveLockedLocalAsset(detail, source, existing, now);
    }

    private EventSourceDefinition buildLockedEventSource(RepositoryEventSourceDetail detail,
                                                         String localAssetId,
                                                         EventSourceDefinition existing,
                                                         LocalDateTime now) {
        EventSourceDefinition source = new EventSourceDefinition()
                .setId(localAssetId)
                .setKey(localAssetId)
                .setName(detail.descriptor().displayName())
                .setDescription(detail.eventSource().description())
                .setScope(EventSourceScope.REPOSITORY)
                .setRepositoryId(detail.descriptor().repositoryId())
                .setRepositoryEventSourceId(detail.descriptor().eventSourceId())
                .setRepositoryVersion(detail.descriptor().version())
                .setTransport(detail.eventSource().transport())
                .setAuth(detail.eventSource().auth())
                .setNormalizationProcessor(detail.eventSource().normalizationProcessor())
                .setWebhookResponse(detail.eventSource().webhookResponse())
                .setSampleContext(detail.eventSource().sampleContext())
                .setEditable(false)
                .setEnabled(existing == null ? true : existing.isEnabled())
                .setCreatedAt(existing == null ? now : existing.getCreatedAt())
                .setUpdatedAt(now)
                .setLastReceivedAt(existing == null ? null : existing.getLastReceivedAt());
        return source;
    }

    private void syncInstalledTriggers(EventSourceDefinition source,
                                       RepositoryEventSourceDetail detail,
                                       LocalDateTime now) {
        Map<String, EventTrigger> existingByTemplateId = repos.eventTriggerRepository().findBySourceId(source.getId()).stream()
                .filter(trigger -> trigger.getRepositoryTriggerId() != null)
                .collect(java.util.stream.Collectors.toMap(EventTrigger::getRepositoryTriggerId, java.util.function.Function.identity(), (a, b) -> a, java.util.LinkedHashMap::new));
        for (EventTriggerTemplateItem template : detail.triggerTemplate()) {
            EventTrigger existing = existingByTemplateId.get(template.id());
            ScriptDefinition target = repos.scriptRepository().findInstalledByRepositorySource(
                    NormalizeUtils.normalize(template.targetScriptDependency().getRepositoryId(), "repositoryId 不能为空"),
                    NormalizeUtils.normalize(template.targetScriptDependency().getToolId(), "toolId 不能为空")
            ).orElseThrow(() -> new IllegalArgumentException("依赖脚本尚未安装: " + template.targetScriptDependency().getRepositoryId() + "/" + template.targetScriptDependency().getToolId()));
            EventTrigger trigger = new EventTrigger()
                    .setId(existing == null ? source.getId() + "." + template.id() : existing.getId())
                    .setName(template.name())
                    .setDescription(template.description())
                    .setScope(EventTriggerScope.REPOSITORY)
                    .setRepositoryId(source.getRepositoryId())
                    .setRepositoryEventSourceId(source.getRepositoryEventSourceId())
                    .setRepositoryVersion(source.getRepositoryVersion())
                    .setRepositoryTriggerId(template.id())
                    .setEditable(false)
                    .setEnabled(existing == null ? template.enabledByDefault() : existing.isEnabled())
                    .setSourceId(source.getId())
                    .setTargetScriptId(target.getId())
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

    private RepositoryLocalAsset saveLockedLocalAsset(RepositoryEventSourceDetail detail,
                                                      EventSourceDefinition source,
                                                      EventSourceDefinition existing,
                                                      LocalDateTime now) {
        RepositoryLocalAsset previous = repos.repositoryLocalAssetRepository()
                .findByLocalAsset(UpstreamAssetType.EVENT_SOURCE, source.getId())
                .orElse(null);
        return repos.repositoryLocalAssetRepository().save(new RepositoryLocalAsset()
                .setId(previous == null ? "EVENT_SOURCE:LOCKED:" + source.getId() : previous.getId())
                .setAssetType(UpstreamAssetType.EVENT_SOURCE)
                .setLocalAssetId(source.getId())
                .setRepositoryId(source.getRepositoryId())
                .setUpstreamAssetId(source.getRepositoryEventSourceId())
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

    private static ProcessorDefinition normalizeProcessor(ProcessorDefinition processor) {
        return processor == null || processor.isEmpty() ? null : processor;
    }
}
