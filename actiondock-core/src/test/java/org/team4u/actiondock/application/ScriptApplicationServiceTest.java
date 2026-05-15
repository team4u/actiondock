package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.mockito.ArgumentCaptor;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ScriptApplicationServiceTest {
    private final ScriptRepository scriptRepository = mock(ScriptRepository.class);
    private final ScriptEngine scriptEngine = mock(ScriptEngine.class);
    private final ScriptScheduleRepository scriptScheduleRepository = mock(ScriptScheduleRepository.class);
    private final RepositoryLocalAssetRepository repositoryLocalAssetRepository = mock(RepositoryLocalAssetRepository.class);
    private final ScriptApplicationService service =
            new ScriptApplicationService(scriptRepository, scriptEngine, scriptScheduleRepository, repositoryLocalAssetRepository);

    @Test
    void saveSetsDefaultsForNewScript() {
        when(scriptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        ScriptDefinition saved = service.save(new ScriptDefinition()
                .setId("script-1")
                .setName("Hello")
                .setSource("return [:]")
                .setVersion(null));

        assertThat(saved.getVersion()).isEqualTo(1);
        assertThat(saved.hasPublishedRevision()).isFalse();
        assertThat(saved.getPackaging()).isEqualTo(ScriptPackaging.TOOL);
        assertThat(saved.getCreatedAt()).isNotNull();
        assertThat(saved.getUpdatedAt()).isNotNull();
        assertThat(saved.getUpdatedAt()).isEqualTo(saved.getCreatedAt());
    }

    @Test
    void savePreservesExistingMetadataWhenUpdating() {
        LocalDateTime createdAt = LocalDateTime.of(2024, 1, 2, 3, 4);
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("script-1")
                .setName("Published")
                .setType(ScriptType.GROOVY)
                .setSource("return [message: 'published']")
                .setPublishedRevision(new PublishedScriptRevision()
                        .setId("rev-script-1")
                        .setScriptId("script-1")
                        .setVersion(7)
                        .setPublishedAt(LocalDateTime.of(2024, 1, 2, 3, 4))
                        .setName("Published")
                        .setType(ScriptType.GROOVY)
                        .setSource("return [message: 'published']")
                        .setInputSchema(Map.of("type", "object"))
                        .setOutputSchema(Map.of("type", "object")))
                .setCreatedAt(createdAt)
                .setVersion(7)));
        when(scriptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        ScriptDefinition saved = service.save(new ScriptDefinition()
                .setId("script-1")
                .setName("Updated")
                .setSource("return [:]")
                .setVersion(null));

        assertThat(saved.getCreatedAt()).isEqualTo(createdAt);
        assertThat(saved.getVersion()).isEqualTo(7);
        assertThat(saved.hasPublishedRevision()).isTrue();
        assertThat(saved.getPublishedRevision()).isNotNull();
        assertThat(saved.getPublishedRevision().getSource()).isEqualTo("return [message: 'published']");
        assertThat(saved.hasUnpublishedChanges()).isTrue();
        assertThat(saved.getUpdatedAt()).isAfterOrEqualTo(createdAt);
    }

    @Test
    void saveMarksWorkingCopyDirtyWhenDefinitionChanges() {
        when(scriptRepository.findById("dev-tool")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("dev-tool")
                .setName("Dev Tool")
                .setType(ScriptType.GROOVY)
                .setSource("return [message: 'remote']")
                .setInputSchema(Map.of("type", "object"))
                .setOutputSchema(Map.of("type", "object"))
                .setScope(ScriptScope.PERSONAL)
                .setRepositoryId("repo")
                .setRepositoryToolId("tool")
                .setRepositoryVersion("1.0.0")
                .setSourcePath("tools/tool")
                .setSourceCommit("abc123")
                .setSourceDigest("digest")
                .setDirty(false)
                .setVersion(1)));
        when(scriptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        ScriptDefinition saved = service.save(new ScriptDefinition()
                .setId("dev-tool")
                .setName("Dev Tool")
                .setType(ScriptType.GROOVY)
                .setSource("return [message: 'local']")
                .setInputSchema(Map.of("type", "object"))
                .setOutputSchema(Map.of("type", "object"))
                .setScope(ScriptScope.PERSONAL));

        assertThat(saved.isDirty()).isTrue();
        assertThat(saved.getRepositoryId()).isEqualTo("repo");
        assertThat(saved.getRepositoryScriptId()).isEqualTo("tool");
        assertThat(saved.getSourcePath()).isEqualTo("tools/tool");
        assertThat(saved.getSourceCommit()).isEqualTo("abc123");
        assertThat(saved.getSourceDigest()).isEqualTo("digest");
    }

    @Test
    void validateDelegatesToScriptEngine() {
        ScriptDefinition definition = new ScriptDefinition().setId("script-1");
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(definition));

        service.validate("script-1");

        verify(scriptEngine).validate(definition);
    }

    @Test
    void publishMarksScriptAsPublishedAndIncrementsVersion() {
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("script-1")
                .setName("Draft")
                .setType(ScriptType.GROOVY)
                .setPackaging(ScriptPackaging.FLOW)
                .setSource("return [message: 'draft']")
                .setPythonRequirements("requests==2.31.0")
                .setOwner("alice")
                .setDescription("draft desc")
                .setTags(List.of("demo"))
                .setPluginDependencies(List.of(new PluginDependency()
                        .setPluginId("email-plugin")
                        .setVersionRange(">= 1.0.0")
                        .setRequiredActions(List.of("send"))))
                .setInputSchema(Map.of("type", "object"))
                .setOutputSchema(Map.of("type", "object"))
                .setVersion(2)));
        when(scriptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        ScriptDefinition published = service.publish("script-1");

        assertThat(published.hasPublishedRevision()).isTrue();
        assertThat(published.getVersion()).isEqualTo(3);
        assertThat(published.getPublishedRevision()).isNotNull();
        assertThat(published.getPackaging()).isEqualTo(ScriptPackaging.FLOW);
        assertThat(published.getPublishedRevision().getPackaging()).isEqualTo(ScriptPackaging.FLOW);
        assertThat(published.getPublishedRevision().getSource()).isEqualTo("return [message: 'draft']");
        assertThat(published.getPublishedRevision().getPythonRequirements()).isEqualTo("requests==2.31.0");
        assertThat(published.getPublishedRevision().getOwner()).isEqualTo("alice");
        assertThat(published.getPublishedRevision().getDescription()).isEqualTo("draft desc");
        assertThat(published.getPublishedRevision().getTags()).containsExactly("demo");
        assertThat(published.getPublishedRevision().getPluginDependencies()).hasSize(1);
        assertThat(published.hasUnpublishedChanges()).isFalse();
        assertThat(published.getUpdatedAt()).isNotNull();
    }

    @Test
    void publishSnapshotKeepsNestedSchemaIndependentFromDraftChanges() {
        Map<String, Object> nestedField = new LinkedHashMap<>(Map.of("type", "string"));
        Map<String, Object> inputSchema = new LinkedHashMap<>();
        inputSchema.put("type", "object");
        inputSchema.put("properties", new LinkedHashMap<>(Map.of("message", nestedField)));

        ScriptDefinition draft = new ScriptDefinition()
                .setId("script-1")
                .setName("Draft")
                .setType(ScriptType.GROOVY)
                .setSource("return [message: 'draft']")
                .setInputSchema(inputSchema)
                .setOutputSchema(Map.of("type", "object"))
                .setVersion(1);
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(draft));
        when(scriptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        ScriptDefinition published = service.publish("script-1");
        @SuppressWarnings("unchecked")
        Map<String, Object> currentProperties = (Map<String, Object>) published.getInputSchema().get("properties");
        @SuppressWarnings("unchecked")
        Map<String, Object> publishedProperties =
                (Map<String, Object>) published.getPublishedRevision().getInputSchema().get("properties");
        @SuppressWarnings("unchecked")
        Map<String, Object> currentMessageField = (Map<String, Object>) currentProperties.get("message");
        @SuppressWarnings("unchecked")
        Map<String, Object> publishedMessageField = (Map<String, Object>) publishedProperties.get("message");

        currentMessageField.put("title", "Message");

        assertThat(publishedMessageField).doesNotContainKey("title");
        assertThat(published.hasUnpublishedChanges()).isTrue();
    }

    @Test
    void getPublishedReturnsPublishedSnapshotContent() {
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("script-1")
                .setName("Draft")
                .setType(ScriptType.PYTHON)
                .setPackaging(ScriptPackaging.TOOL)
                .setSource("return {'message': 'draft'}")
                .setPublishedRevision(new PublishedScriptRevision()
                        .setId("rev-script-1")
                        .setScriptId("script-1")
                        .setVersion(4)
                        .setPublishedAt(LocalDateTime.of(2026, 4, 30, 10, 0))
                        .setName("Live")
                        .setType(ScriptType.GROOVY)
                        .setPackaging(ScriptPackaging.FLOW)
                        .setSource("return [message: 'live']")
                        .setPythonRequirements("requests==2.31.0")
                        .setOwner("platform")
                        .setDescription("published desc")
                        .setTags(List.of("stable"))
                        .setInputSchema(Map.of("type", "object"))
                        .setOutputSchema(Map.of("properties", Map.of("message", Map.of("type", "string"))))
                        .setPluginDependencies(List.of(new PluginDependency()
                                .setPluginId("email-plugin")
                                .setVersionRange(">= 1.0.0")
                                .setRequiredActions(List.of("send")))))
                .setVersion(4)));

        ScriptDefinition published = service.getPublished("script-1");

        assertThat(published.getName()).isEqualTo("Live");
        assertThat(published.getType()).isEqualTo(ScriptType.GROOVY);
        assertThat(published.getPackaging()).isEqualTo(ScriptPackaging.FLOW);
        assertThat(published.getSource()).isEqualTo("return [message: 'live']");
        assertThat(published.getPythonRequirements()).isEqualTo("requests==2.31.0");
        assertThat(published.getOwner()).isEqualTo("platform");
        assertThat(published.getDescription()).isEqualTo("published desc");
        assertThat(published.getTags()).containsExactly("stable");
        assertThat(published.getPluginDependencies()).hasSize(1);
        assertThat(published.hasPublishedRevision()).isTrue();
        assertThat(published.hasUnpublishedChanges()).isFalse();
    }

    @Test
    void discardDraftRestoresPublishedSnapshotWithoutIncrementingVersion() {
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("script-1")
                .setName("Draft")
                .setType(ScriptType.PYTHON)
                .setPackaging(ScriptPackaging.TOOL)
                .setSource("return {'message': 'draft'}")
                .setPublishedRevision(new PublishedScriptRevision()
                        .setId("rev-script-1")
                        .setScriptId("script-1")
                        .setVersion(5)
                        .setPublishedAt(LocalDateTime.of(2026, 4, 30, 10, 0))
                        .setName("Live")
                        .setType(ScriptType.GROOVY)
                        .setPackaging(ScriptPackaging.FLOW)
                        .setSource("return [message: 'live']")
                        .setDescription("published desc")
                        .setInputSchema(Map.of("type", "object"))
                        .setOutputSchema(Map.of("type", "object")))
                .setVersion(5)));
        when(scriptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        ScriptDefinition discarded = service.discardDraft("script-1");

        assertThat(discarded.getName()).isEqualTo("Live");
        assertThat(discarded.getType()).isEqualTo(ScriptType.GROOVY);
        assertThat(discarded.getPackaging()).isEqualTo(ScriptPackaging.FLOW);
        assertThat(discarded.getSource()).isEqualTo("return [message: 'live']");
        assertThat(discarded.getDescription()).isEqualTo("published desc");
        assertThat(discarded.getVersion()).isEqualTo(5);
        assertThat(discarded.hasUnpublishedChanges()).isFalse();
    }

    @Test
    void getPublishedLeavesMissingLegacySnapshotFieldsEmpty() {
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("script-1")
                .setName("Draft")
                .setType(ScriptType.GROOVY)
                .setSource("return [message: 'draft']")
                .setOwner("draft-owner")
                .setDescription("draft desc")
                .setTags(List.of("draft"))
                .setPublishedRevision(new PublishedScriptRevision()
                        .setId("rev-script-1")
                        .setScriptId("script-1")
                        .setVersion(2)
                        .setPublishedAt(LocalDateTime.of(2026, 4, 30, 10, 0))
                        .setName("Live")
                        .setType(ScriptType.GROOVY)
                        .setSource("return [message: 'live']")
                        .setInputSchema(Map.of("type", "object"))
                        .setOutputSchema(Map.of("type", "object")))
                .setVersion(2)));

        ScriptDefinition published = service.getPublished("script-1");

        assertThat(published.getOwner()).isNull();
        assertThat(published.getDescription()).isNull();
        assertThat(published.getTags()).isEmpty();
        assertThat(published.getPluginDependencies()).isEmpty();
    }

    @Test
    void discardDraftRejectsUnpublishedScript() {
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("script-1")));

        assertThatThrownBy(() -> service.discardDraft("script-1"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("脚本未发布: script-1");
    }

    @Test
    void createForkCopiesRepositoryScriptAndSchedules() {
        ScriptDefinition source = new ScriptDefinition()
                .setId("repo.tool")
                .setName("Repository Tool")
                .setType(ScriptType.GROOVY)
                .setSource("return [message: 'draft']")
                .setPublishedRevision(new PublishedScriptRevision()
                        .setId("rev-repo.tool")
                        .setScriptId("repo.tool")
                        .setVersion(4)
                        .setPublishedAt(LocalDateTime.of(2026, 4, 30, 10, 0))
                        .setName("Live Tool")
                        .setType(ScriptType.PYTHON)
                        .setSource("return {'message': 'live'}")
                        .setInputSchema(Map.of("type", "object"))
                        .setOutputSchema(Map.of("type", "object")))
                .setVersion(4)
                .setScope(ScriptScope.REPOSITORY)
                .setRepositoryId("repo")
                .setRepositoryToolId("tool")
                .setRepositoryVersion("1.0.0")
                .setEditable(false);
        ScriptSchedule sourceSchedule = new ScriptSchedule()
                .setId("schedule-1")
                .setScriptId("repo.tool")
                .setName("Nightly")
                .setCronExpression("0 0 2 * * *")
                .setInput(Map.of("endpoint", "${config.service.endpoint}"))
                .setEnabled(true)
                .setEditable(false)
                .setRepositoryId("repo")
                .setRepositoryToolId("repo.tool")
                .setRepositoryVersion("1.0.0")
                .setLastTriggeredAt(LocalDateTime.of(2026, 4, 24, 2, 0))
                .setLastExecutionId("exec-1");
        when(scriptRepository.findById("repo.tool")).thenReturn(Optional.of(source));
        when(scriptRepository.findById("tool-fork")).thenReturn(Optional.empty());
        when(scriptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(scriptScheduleRepository.findByScriptId("repo.tool")).thenReturn(List.of(sourceSchedule));
        when(scriptScheduleRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        ScriptDefinition fork = service.createFork("repo.tool", "tool-fork", "Tool Fork");

        assertThat(fork.getId()).isEqualTo("tool-fork");
        assertThat(fork.getName()).isEqualTo("Tool Fork");
        assertThat(fork.getScope()).isEqualTo(ScriptScope.PERSONAL);
        assertThat(fork.isEditable()).isTrue();
        assertThat(fork.getRepositoryId()).isEqualTo("repo");
        assertThat(fork.getRepositoryScriptId()).isEqualTo("tool");
        assertThat(fork.getRepositoryVersion()).isEqualTo("1.0.0");
        assertThat(fork.getSource()).isEqualTo("return {'message': 'live'}");
        assertThat(fork.getPublishedRevision()).isNotNull();

        ArgumentCaptor<ScriptSchedule> scheduleCaptor = ArgumentCaptor.forClass(ScriptSchedule.class);
        verify(scriptScheduleRepository).save(scheduleCaptor.capture());
        ScriptSchedule forkSchedule = scheduleCaptor.getValue();
        assertThat(forkSchedule.getId()).isNotEqualTo("schedule-1");
        assertThat(forkSchedule.getScriptId()).isEqualTo("tool-fork");
        assertThat(forkSchedule.getName()).isEqualTo("Nightly");
        assertThat(forkSchedule.getCronExpression()).isEqualTo("0 0 2 * * *");
        assertThat(forkSchedule.getInput()).containsEntry("endpoint", "${config.service.endpoint}");
        assertThat(forkSchedule.isEnabled()).isFalse();
        assertThat(forkSchedule.isEditable()).isTrue();
        assertThat(forkSchedule.getRepositoryId()).isNull();
        assertThat(forkSchedule.getRepositoryScriptId()).isNull();
        assertThat(forkSchedule.getRepositoryVersion()).isNull();
        assertThat(forkSchedule.getLastTriggeredAt()).isNull();
        assertThat(forkSchedule.getLastExecutionId()).isNull();
        assertThat(forkSchedule.getCreatedAt()).isNotNull();
        assertThat(forkSchedule.getUpdatedAt()).isNotNull();
    }

    @Test
    void createForkRejectsExistingTargetId() {
        when(scriptRepository.findById("repo.tool")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("repo.tool")
                .setScope(ScriptScope.REPOSITORY)));
        when(scriptRepository.findById("tool-fork")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("tool-fork")));

        assertThatThrownBy(() -> service.createFork("repo.tool", "tool-fork", "Tool Fork"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("脚本已存在: tool-fork");
    }

    @Test
    void createForkRejectsNonRepositoryScript() {
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("script-1")
                .setScope(ScriptScope.PERSONAL)));

        assertThatThrownBy(() -> service.createFork("script-1", "script-fork", "Script Fork"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("仅支持从仓库工具创建 Fork");
    }

    @Test
    void getThrowsWhenScriptMissing() {
        when(scriptRepository.findById("missing")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.get("missing"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("脚本不存在: missing");
    }

    @Test
    void listDelegatesToRepository() {
        List<ScriptDefinition> definitions = List.of(new ScriptDefinition().setId("script-1"));
        when(scriptRepository.findAll()).thenReturn(definitions);

        assertThat(service.list()).containsExactlyElementsOf(definitions);
    }

    @Test
    void deleteRemovesSchedulesBeforeDeletingScript() {
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("script-1")));
        when(repositoryLocalAssetRepository.findByLocalAsset(UpstreamAssetType.SCRIPT, "script-1")).thenReturn(Optional.empty());

        service.delete("script-1");

        verify(scriptScheduleRepository).deleteByScriptId("script-1");
        verify(scriptRepository).deleteById("script-1");
    }

    @Test
    void deleteRemovesLocalAssetForWorkingCopy() {
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("script-1")));
        when(repositoryLocalAssetRepository.findByLocalAsset(UpstreamAssetType.SCRIPT, "script-1"))
                .thenReturn(Optional.of(new RepositoryLocalAsset()
                        .setId("asset-1")
                        .setAssetType(UpstreamAssetType.SCRIPT)
                        .setLocalAssetId("script-1")));

        service.delete("script-1");

        verify(scriptScheduleRepository).deleteByScriptId("script-1");
        verify(repositoryLocalAssetRepository).deleteById("asset-1");
        verify(scriptRepository).deleteById("script-1");
    }
}
