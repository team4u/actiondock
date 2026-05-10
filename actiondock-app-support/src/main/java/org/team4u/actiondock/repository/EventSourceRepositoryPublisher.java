package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.exception.UpstreamConflictException;
import org.team4u.actiondock.domain.model.EventSourceAuthConfig;
import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventSourceScope;
import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.ProcessorDefinition;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.RepositoryEventTriggerBinding;
import org.team4u.actiondock.domain.model.ScriptDependency;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.domain.model.UpstreamBinding;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

final class EventSourceRepositoryPublisher {

    private static final String EVENT_SOURCE_CONFIG_TEMPLATE_FILE = "config.template.json";
    private static final String EVENT_SOURCE_TRIGGER_TEMPLATE_FILE = "triggers.template.json";

    private final RepositoryCatalogService catalog;
    private final RepositoryCatalogService.Repositories repos;

    EventSourceRepositoryPublisher(RepositoryCatalogService catalog,
                                   RepositoryCatalogService.Repositories repos) {
        this.catalog = catalog;
        this.repos = repos;
    }

    RepositoryEventSourceDescriptor publish(String repositoryId, RepositoryEventSourcePublishRequest request) {
        WritableRepositorySession session = catalog.openWritableRepositorySession(repositoryId);
        RepositoryDefinition repository = session.repository();
        EventSourceDefinition source = requireSource(request.sourceId());
        UpstreamBinding upstreamBinding = repos.upstreamBindingRepository()
                .findByLocalAsset(UpstreamAssetType.EVENT_SOURCE, source.getId())
                .orElse(null);
        if (upstreamBinding != null && Objects.equals(upstreamBinding.getRepositoryId(), repositoryId) && !request.force()) {
            assertUpstreamPublishSafe(source, repository, upstreamBinding);
        }

        String eventSourceId = NormalizeUtils.normalize(request.eventSourceId(), "eventSourceId 不能为空");
        String version = NormalizeUtils.normalize(request.version(), "version 不能为空");
        List<EventTrigger> selectedTriggers = resolveSelectedTriggers(source.getId(), request.triggerIds());
        List<ScriptDependency> scriptDependencies = resolveScriptDependencies(repositoryId, selectedTriggers, request.triggerBindings());
        List<ConfigTemplateItem> configTemplates = buildConfigTemplates(source, selectedTriggers, request.configItems());

        assertEventSourceVersionAvailable(repositoryId, session.index(), eventSourceId, version);
        Path eventSourceDir = session.root().resolve(EVENT_SOURCES_DIR).resolve(eventSourceId);
        List<EventTriggerTemplateItem> triggerTemplates = buildTriggerTemplates(selectedTriggers, scriptDependencies);
        EventSourceFile file = buildEventSourceFile(source, request, eventSourceId, configTemplates, triggerTemplates, scriptDependencies);
        catalog.writeJson(eventSourceDir.resolve(EVENT_SOURCE_DESCRIPTOR_FILE), file);
        if (!configTemplates.isEmpty()) {
            catalog.writeJson(eventSourceDir.resolve(EVENT_SOURCE_CONFIG_TEMPLATE_FILE), configTemplates);
        }
        if (!triggerTemplates.isEmpty()) {
            catalog.writeJson(eventSourceDir.resolve(EVENT_SOURCE_TRIGGER_TEMPLATE_FILE), triggerTemplates);
        }
        updateRepositoryIndex(session.root(), repository, file);
        session.commitPublishedAsset(eventSourceId, version, request.releaseNotes());

        RepositoryEventSourceDetail publishedDetail = catalog.getRepositoryEventSource(repositoryId, eventSourceId);
        if (upstreamBinding != null
                && Objects.equals(upstreamBinding.getRepositoryId(), repositoryId)
                && Objects.equals(upstreamBinding.getUpstreamAssetId(), eventSourceId)) {
            updateUpstreamBinding(upstreamBinding, publishedDetail);
        }
        return publishedDetail.descriptor();
    }

    RepositoryEventSourcePublishPreview preview(RepositoryEventSourcePublishPreviewRequest request) {
        EventSourceDefinition source = requireSource(request.sourceId());
        List<EventTrigger> selectedTriggers = resolveSelectedTriggers(source.getId(), request.triggerIds());
        List<ScriptDependency> dependencies = inferScriptDependencies(selectedTriggers);
        RepositoryPublishConfigResolver.PublishConfigResolution resolution = RepositoryPublishConfigResolver.resolve(
                collectConfigSource(source, selectedTriggers),
                List.of(),
                repos.configValueRepository().findAll()
        );
        List<RepositoryPublishConfigCandidate> candidates = resolution.items().stream()
                .map(item -> new RepositoryPublishConfigCandidate(item.key(), item.label(), item.secret()))
                .toList();
        return new RepositoryEventSourcePublishPreview(
                candidates,
                resolution.missingKeys(),
                buildTriggerTemplates(selectedTriggers, dependencies),
                dependencies
        );
    }

    private EventSourceDefinition requireSource(String sourceId) {
        return repos.eventSourceRepository().findById(NormalizeUtils.normalize(sourceId, "sourceId 不能为空"))
                .orElseThrow(() -> new IllegalArgumentException("事件源不存在: " + sourceId));
    }

    private void assertUpstreamPublishSafe(EventSourceDefinition source,
                                           RepositoryDefinition repository,
                                           UpstreamBinding binding) {
        RepositoryEventSourceDetail detail = catalog.getRepositoryEventSource(repository.getId(), binding.getUpstreamAssetId());
        ToolSourceState state = catalog.resolveEventSourceState(repository, detail);
        List<EventTrigger> triggers = repos.eventTriggerRepository().findBySourceId(source.getId());
        String localDigest = catalog.computeEventSourceLocalDigest(source, triggers);
        UpstreamSyncState syncState = UpstreamSyncService.resolveSyncState(binding, localDigest, state);
        if (syncState == UpstreamSyncState.REMOTE_CHANGES || syncState == UpstreamSyncState.DIVERGED) {
            throw new UpstreamConflictException(source.getId(), binding.getRepositoryId(), binding.getUpstreamAssetId());
        }
    }

    private void updateUpstreamBinding(UpstreamBinding binding, RepositoryEventSourceDetail detail) {
        ToolSourceState state = catalog.resolveEventSourceState(catalog.getRepository(binding.getRepositoryId()), detail);
        repos.upstreamBindingRepository().save(binding
                .setUpstreamVersion(detail.descriptor().version())
                .setSourcePath(state.path())
                .setBaseCommit(state.commit())
                .setBaseDigest(state.digest())
                .setLastSyncedAt(LocalDateTime.now())
                .setUpdatedAt(LocalDateTime.now()));
    }

    private List<EventTrigger> resolveSelectedTriggers(String sourceId, List<String> requestedIds) {
        List<EventTrigger> all = repos.eventTriggerRepository().findBySourceId(sourceId);
        if (requestedIds == null || requestedIds.isEmpty()) {
            return all;
        }
        LinkedHashSet<String> ids = new LinkedHashSet<>();
        for (String requestedId : requestedIds) {
            ids.add(NormalizeUtils.normalize(requestedId, "triggerId 不能为空"));
        }
        return all.stream()
                .filter(trigger -> ids.contains(trigger.getId()))
                .toList();
    }

    private List<ScriptDependency> inferScriptDependencies(List<EventTrigger> selectedTriggers) {
        List<ScriptDependency> dependencies = new ArrayList<>();
        for (EventTrigger trigger : selectedTriggers) {
            ScriptDefinition target = repos.scriptRepository().findById(
                    NormalizeUtils.normalize(trigger.getTargetScriptId(), "事件触发器 targetScriptId 不能为空: " + trigger.getId()))
                    .orElseThrow(() -> new IllegalArgumentException("事件触发器目标脚本不存在: " + trigger.getTargetScriptId()));
            if (target.getPublishedSnapshot() == null && target.getScope() != ScriptScope.REPOSITORY && NormalizeUtils.isBlank(target.getRepositoryId())) {
                throw new IllegalArgumentException("事件触发器目标脚本尚未发布: " + trigger.getTargetScriptId());
            }
            ScriptDependency dependency = new ScriptDependency()
                    .setScriptId(target.getId())
                    .setRepositoryId(target.getRepositoryId())
                    .setToolId(target.getRepositoryToolId())
                    .setVersionRange(target.getRepositoryVersion() == null ? null : ">= " + target.getRepositoryVersion());
            dependencies.add(dependency);
        }
        return normalizeScriptDependencies(dependencies);
    }

    private List<ScriptDependency> resolveScriptDependencies(String defaultRepositoryId,
                                                             List<EventTrigger> selectedTriggers,
                                                             List<RepositoryEventTriggerBinding> bindings) {
        Map<String, RepositoryEventTriggerBinding> byTemplateId = new LinkedHashMap<>();
        for (RepositoryEventTriggerBinding binding : NormalizeUtils.nullSafeList(bindings)) {
            String templateId = NormalizeUtils.normalize(binding.getTemplateId(), "triggerBinding.templateId 不能为空");
            if (byTemplateId.putIfAbsent(templateId, binding) != null) {
                throw new IllegalArgumentException("重复的触发器绑定: " + templateId);
            }
        }

        List<ScriptDependency> dependencies = new ArrayList<>();
        for (EventTrigger trigger : selectedTriggers) {
            ScriptDefinition target = repos.scriptRepository().findById(
                    NormalizeUtils.normalize(trigger.getTargetScriptId(), "事件触发器 targetScriptId 不能为空: " + trigger.getId()))
                    .orElseThrow(() -> new IllegalArgumentException("事件触发器目标脚本不存在: " + trigger.getTargetScriptId()));
            RepositoryEventTriggerBinding binding = byTemplateId.get(trigger.getId());
            if (binding == null && !NormalizeUtils.isBlank(target.getRepositoryId()) && !NormalizeUtils.isBlank(target.getRepositoryToolId())) {
                dependencies.add(new ScriptDependency()
                        .setScriptId(target.getId())
                        .setRepositoryId(target.getRepositoryId())
                        .setToolId(target.getRepositoryToolId())
                        .setVersionRange(target.getRepositoryVersion() == null ? null : ">= " + target.getRepositoryVersion()));
                continue;
            }
            if (binding == null) {
                throw new IllegalArgumentException("缺少触发器目标脚本仓库映射: " + trigger.getId());
            }
            dependencies.add(new ScriptDependency()
                    .setScriptId(NormalizeUtils.normalizeOrDefault(binding.getScriptId(), target.getId()))
                    .setRepositoryId(NormalizeUtils.normalizeOrDefault(binding.getRepositoryId(), defaultRepositoryId))
                    .setToolId(NormalizeUtils.normalize(binding.getToolId(), "triggerBinding.toolId 不能为空: " + trigger.getId()))
                    .setVersionRange(NormalizeUtils.normalizeNullable(binding.getVersionRange())));
        }
        return normalizeScriptDependencies(dependencies);
    }

    private List<ConfigTemplateItem> buildConfigTemplates(EventSourceDefinition source,
                                                          List<EventTrigger> triggers,
                                                          List<RepositoryPublishConfigItem> configItems) {
        RepositoryPublishConfigResolver.PublishConfigResolution resolution = RepositoryPublishConfigResolver.resolve(
                collectConfigSource(source, triggers),
                List.of(),
                repos.configValueRepository().findAll()
        );
        List<ConfigTemplateItem> templates = RepositoryPublishConfigResolver.buildTemplates(resolution, configItems);
        EventSourceAuthConfig auth = source.getAuth();
        if (auth != null && !NormalizeUtils.isBlank(auth.getSecretConfigKey())) {
            boolean exists = templates.stream().anyMatch(item -> auth.getSecretConfigKey().equals(item.key()));
            if (!exists) {
                templates = new ArrayList<>(templates);
                templates.add(new ConfigTemplateItem(auth.getSecretConfigKey(), auth.getSecretConfigKey(), "string", false, true, null));
            }
        }
        return templates.stream()
                .sorted(java.util.Comparator.comparing(ConfigTemplateItem::key))
                .toList();
    }

    private String collectConfigSource(EventSourceDefinition source, List<EventTrigger> triggers) {
        StringBuilder builder = new StringBuilder();
        appendAuth(builder, source.getAuth());
        appendProcessor(builder, source.getNormalizationProcessor());
        for (EventTrigger trigger : triggers) {
            appendProcessor(builder, trigger.getFilterProcessor());
            appendProcessor(builder, trigger.getIdempotencyProcessor());
            appendProcessor(builder, trigger.getInputProcessor());
        }
        return builder.toString();
    }

    private void appendAuth(StringBuilder builder, EventSourceAuthConfig auth) {
        if (auth == null || NormalizeUtils.isBlank(auth.getSecretConfigKey())) {
            return;
        }
        builder.append("config['").append(auth.getSecretConfigKey()).append("']").append('\n');
    }

    private void appendProcessor(StringBuilder builder, ProcessorDefinition processor) {
        if (processor == null) {
            return;
        }
        builder.append(catalog.jsonCodec().write(processor)).append('\n');
    }

    private List<ScriptDependency> normalizeScriptDependencies(List<ScriptDependency> dependencies) {
        LinkedHashMap<String, ScriptDependency> normalized = new LinkedHashMap<>();
        for (ScriptDependency dependency : dependencies) {
            String key = NormalizeUtils.normalize(dependency.getScriptId(), "scriptId 不能为空")
                    + "|" + NormalizeUtils.normalize(dependency.getRepositoryId(), "repositoryId 不能为空")
                    + "|" + NormalizeUtils.normalize(dependency.getToolId(), "toolId 不能为空");
            normalized.putIfAbsent(key, dependency);
        }
        return List.copyOf(normalized.values());
    }

    private List<EventTriggerTemplateItem> buildTriggerTemplates(List<EventTrigger> triggers,
                                                                 List<ScriptDependency> scriptDependencies) {
        Map<String, ScriptDependency> dependencyByScriptId = new LinkedHashMap<>();
        for (ScriptDependency dependency : scriptDependencies) {
            dependencyByScriptId.putIfAbsent(dependency.getScriptId(), dependency);
        }
        List<EventTriggerTemplateItem> templates = new ArrayList<>();
        for (EventTrigger trigger : triggers) {
            ScriptDependency dependency = dependencyByScriptId.get(trigger.getTargetScriptId());
            if (dependency == null) {
                throw new IllegalArgumentException("缺少触发器目标脚本依赖映射: " + trigger.getTargetScriptId());
            }
            templates.add(new EventTriggerTemplateItem(
                    trigger.getId(),
                    trigger.getName(),
                    NormalizeUtils.normalizeNullable(trigger.getDescription()),
                    trigger.isEnabled(),
                    dependency,
                    trigger.getFilterProcessor(),
                    trigger.getIdempotencyProcessor(),
                    trigger.getInputProcessor(),
                    trigger.getSubmitMode() == null ? null : trigger.getSubmitMode().name(),
                    trigger.getResponseView()
            ));
        }
        return templates;
    }

    private EventSourceFile buildEventSourceFile(EventSourceDefinition source,
                                                 RepositoryEventSourcePublishRequest request,
                                                 String eventSourceId,
                                                 List<ConfigTemplateItem> configTemplates,
                                                 List<EventTriggerTemplateItem> triggerTemplates,
                                                 List<ScriptDependency> scriptDependencies) {
        EventSourceFile initial = new EventSourceFile(
                RepositoryIndexUtils.DEFAULT_VERSION,
                eventSourceId,
                NormalizeUtils.normalizeOrDefault(request.displayName(), source.getName()),
                NormalizeUtils.normalize(request.version(), "version 不能为空"),
                NormalizeUtils.normalizeNullable(source.getDescription()),
                NormalizeUtils.normalizeNullable(request.releaseNotes()),
                NormalizeUtils.normalizeNullable(request.owner()),
                NormalizeUtils.nullSafeList(request.tags()),
                null,
                source.getTransport(),
                source.getAuth(),
                source.getNormalizationProcessor(),
                source.getWebhookResponse(),
                source.getSampleContext(),
                scriptDependencies,
                configTemplates.isEmpty() ? null : EVENT_SOURCE_CONFIG_TEMPLATE_FILE,
                triggerTemplates.isEmpty() ? null : EVENT_SOURCE_TRIGGER_TEMPLATE_FILE
        );
        String digest = RepositoryVersionUtils.sha256(catalog.jsonCodec().write(initial));
        return new EventSourceFile(
                initial.schemaVersion(),
                initial.eventSourceId(),
                initial.displayName(),
                initial.version(),
                initial.description(),
                initial.releaseNotes(),
                initial.owner(),
                initial.tags(),
                digest,
                initial.transport(),
                initial.auth(),
                initial.normalizationProcessor(),
                initial.webhookResponse(),
                initial.sampleContext(),
                initial.scriptDependencies(),
                initial.configTemplatePath(),
                initial.triggerTemplatePath()
        );
    }

    private void updateRepositoryIndex(Path root,
                                       RepositoryDefinition repository,
                                       EventSourceFile eventSource) {
        RepositoryIndexFile current = catalog.readRepositoryIndexFile(root, repository);
        RepositoryEventSourceIndexEntry next = new RepositoryEventSourceIndexEntry(
                eventSource.eventSourceId(),
                eventSource.displayName(),
                eventSource.version(),
                eventSource.description(),
                eventSource.releaseNotes(),
                EVENT_SOURCES_DIR + "/" + eventSource.eventSourceId() + "/" + EVENT_SOURCE_DESCRIPTOR_FILE
        );
        List<RepositoryEventSourceIndexEntry> entries =
                RepositoryIndexUtils.upsertSorted(current.safeEventSources(), next, RepositoryEventSourceIndexEntry::id);
        catalog.writeJson(root.resolve(REPOSITORY_INDEX_FILE), RepositoryIndexUtils.withEventSources(current, repository, entries));
    }

    private void updateWorkingCopySourceMetadata(EventSourceDefinition source,
                                                 RepositoryDefinition repository,
                                                 RepositoryEventSourceDetail detail) {
        ToolSourceState state = catalog.resolveEventSourceState(repository, detail);
        EventSourceDefinition updated = repos.eventSourceRepository().findById(source.getId())
                .orElse(source);
        updated.setRepositoryVersion(detail.descriptor().version())
                .setSourcePath(state.path())
                .setSourceCommit(state.commit())
                .setSourceDigest(state.digest())
                .setSourceSyncedAt(LocalDateTime.now())
                .setDirty(false);
        repos.eventSourceRepository().save(updated);
    }
}
