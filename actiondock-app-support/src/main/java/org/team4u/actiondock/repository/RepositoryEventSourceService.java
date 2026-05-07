package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventSourceScope;
import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.EventTriggerScope;
import org.team4u.actiondock.domain.model.RepositoryEventSourceInstallation;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

public class RepositoryEventSourceService {

    private final RepositoryCatalogService catalog;
    private final RepositoryCatalogService.Repositories repos;
    private final DevelopmentSyncService developmentSync;
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
        this.developmentSync = new DevelopmentSyncService(catalog, repos, catalog.getServices());
        this.publisher = new EventSourceRepositoryPublisher(catalog, repos);
    }

    public RepositoryEventSourcePublishPreview previewPublish(RepositoryEventSourcePublishPreviewRequest request) {
        return publisher.preview(request);
    }

    public RepositoryEventSourceDescriptor publishEventSource(String repositoryId, RepositoryEventSourcePublishRequest request) {
        return publisher.publish(repositoryId, request);
    }

    public RepositoryEventSourceInstallation installEventSource(String repositoryId,
                                                                String eventSourceId,
                                                                ToolInstallationOptions options) {
        return installOrUpdate(repositoryId, eventSourceId, options, false, new LinkedHashSet<>());
    }

    public RepositoryEventSourceInstallation updateEventSource(String repositoryId,
                                                               String eventSourceId,
                                                               ToolInstallationOptions options) {
        return installOrUpdate(repositoryId, eventSourceId, options, true, new LinkedHashSet<>());
    }

    public EventSourceDefinition syncEventSourceForDevelopment(String repositoryId,
                                                               String eventSourceId,
                                                               DevelopmentSyncRequest request) {
        return developmentSync.syncEventSourceForDevelopment(repositoryId, eventSourceId, request);
    }

    public DevelopmentStatus getDevelopmentStatus(String eventSourceId) {
        return developmentSync.getEventSourceDevelopmentStatus(eventSourceId);
    }

    public EventSourceDefinition pullDevelopmentEventSource(String eventSourceId, boolean force) {
        return developmentSync.pullDevelopmentEventSource(eventSourceId, force);
    }

    public void uninstallEventSource(String installedSourceId) {
        EventSourceDefinition source = repos.eventSourceRepository().findById(installedSourceId)
                .orElseThrow(() -> new IllegalArgumentException("已安装事件源不存在: " + installedSourceId));
        for (EventTrigger trigger : repos.eventTriggerRepository().findBySourceId(source.getId())) {
            repos.eventTriggerRepository().deleteById(trigger.getId());
        }
        repos.eventSourceRepository().deleteById(source.getId());
        repos.repositoryEventSourceInstallationRepository().deleteBySourceId(installedSourceId);
        configTemplateSyncService.removeManagedConfigTemplates(source.getRepositoryId(), source.getRepositoryEventSourceId());
    }

    private RepositoryEventSourceInstallation installOrUpdate(String repositoryId,
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
            String installedSourceId = detail.descriptor().installedSourceId();
            EventSourceDefinition existing = repos.eventSourceRepository().findById(installedSourceId).orElse(null);
            if (updateOnly && existing == null) {
                throw new IllegalArgumentException("事件源尚未安装: " + installedSourceId);
            }
            resolveScriptDependencies(detail, options, visiting);
            return persistInstallation(repositoryId, detail, existing);
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
            repositoryToolService.installTool(
                    dependency.getRepositoryId(),
                    dependency.getToolId(),
                    new ToolInstallationOptions(false, true, options.installPluginDependencies(), options.forcePluginUpgrade())
            );
        }
    }

    private RepositoryEventSourceInstallation persistInstallation(String repositoryId,
                                                                  RepositoryEventSourceDetail detail,
                                                                  EventSourceDefinition existing) {
        LocalDateTime now = LocalDateTime.now();
        EventSourceDefinition source = buildInstalledEventSource(detail, existing, now);
        repos.eventSourceRepository().save(source);
        syncInstalledTriggers(source, detail, now);
        configTemplateSyncService.syncConfigTemplates(repositoryId, detail.descriptor().eventSourceId(), detail.descriptor().version(), detail.configTemplate());
        return saveInstallationRecord(detail, source, existing, now);
    }

    private EventSourceDefinition buildInstalledEventSource(RepositoryEventSourceDetail detail,
                                                            EventSourceDefinition existing,
                                                            LocalDateTime now) {
        EventSourceDefinition source = new EventSourceDefinition()
                .setId(detail.descriptor().installedSourceId())
                .setKey(detail.descriptor().installedSourceId())
                .setName(detail.descriptor().displayName())
                .setDescription(detail.eventSource().description())
                .setScope(EventSourceScope.REPOSITORY)
                .setRepositoryId(detail.descriptor().repositoryId())
                .setRepositoryEventSourceId(detail.descriptor().eventSourceId())
                .setRepositoryVersion(detail.descriptor().version())
                .setTransport(detail.eventSource().transport())
                .setAuth(detail.eventSource().auth())
                .setNormalizationProcessor(detail.eventSource().normalizationProcessor())
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
                    .setFilterProcessor(template.filterProcessor())
                    .setIdempotencyProcessor(template.idempotencyProcessor())
                    .setInputProcessor(template.inputProcessor())
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

    private RepositoryEventSourceInstallation saveInstallationRecord(RepositoryEventSourceDetail detail,
                                                                     EventSourceDefinition source,
                                                                     EventSourceDefinition existing,
                                                                     LocalDateTime now) {
        RepositoryEventSourceInstallation installation = new RepositoryEventSourceInstallation()
                .setSourceId(source.getId())
                .setRepositoryId(source.getRepositoryId())
                .setEventSourceId(source.getRepositoryEventSourceId())
                .setName(source.getName())
                .setVersion(detail.descriptor().version())
                .setLatestVersion(detail.descriptor().version())
                .setOwner(detail.descriptor().owner())
                .setDescription(detail.descriptor().description())
                .setInstalledAt(existing == null ? now : Optional.ofNullable(repos.repositoryEventSourceInstallationRepository()
                        .findBySourceId(source.getId())
                        .map(RepositoryEventSourceInstallation::getInstalledAt)
                        .orElse(null)).orElse(now))
                .setUpdatedAt(now);
        return repos.repositoryEventSourceInstallationRepository().save(installation);
    }
}
