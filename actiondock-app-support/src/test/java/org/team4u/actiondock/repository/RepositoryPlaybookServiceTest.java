package org.team4u.actiondock.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRef;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRefType;
import org.team4u.actiondock.domain.model.PlaybookRelatedRef;
import org.team4u.actiondock.domain.model.PlaybookScriptRef;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.model.ScriptScope;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.domain.port.CapabilityPackageInstallationRepository;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.ExecutionPresetRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ManagedSkillRepository;
import org.team4u.actiondock.domain.port.PlaybookRepository;
import org.team4u.actiondock.domain.port.RepositoryDefinitionRepository;
import org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.plugin.PluginRuntimeService;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.REPO_PURPOSE_CAPABILITY;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.REPO_TYPE_GIT;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.REPO_TYPE_LOCAL_DIR;

class RepositoryPlaybookServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final JsonCodec jsonCodec = new TestJsonCodec();

    @TempDir
    Path tempDir;

    @Test
    void installsLockedPlaybookDependencyClosureAndRewritesReferences() throws Exception {
        TestServices services = createServices();
        Path repoRoot = createCapabilityRepository("capability");
        writeScript(repoRoot, "script-child", "1.0.0", List.of(), List.of(), true);
        writeScript(repoRoot, "script-main", "1.0.0",
                List.of(new org.team4u.actiondock.domain.model.ScriptDependency()
                        .setScriptId("script-child")
                        .setRepositoryId("capability")
                        .setRepositoryScriptId("script-child")),
                List.of(new PluginDependency().setPluginId("plugin-a").setVersionRange(">= 1.0.0")),
                true);
        writeKnowledge(repoRoot, "billing-docs");
        writePlaybook(repoRoot, "playbook-related", "1.0.0", List.of(), List.of(), List.of(), List.of());
        writePlaybook(repoRoot, "playbook-main", "1.0.0",
                List.of("billing-docs"),
                List.of(new PlaybookKnowledgeRef()
                        .setType(PlaybookKnowledgeRefType.FILE)
                        .setRepositoryId("billing-docs")
                        .setPath("ACTIONDOCK.md")),
                List.of(new PlaybookScriptRef().setScriptId("script-main").setPurpose("query")),
                List.of(new PlaybookRelatedRef().setPlaybookId("playbook-related")));
        services.repositoryDefinitionRepository.save(capabilityRepo("capability", repoRoot));
        RepositoryPlaybookService playbookService = createPlaybookService(services);

        RepositoryLocalAsset asset = playbookService.addLocalAsset("capability", "playbook-main",
                new RepositoryCatalogTypes.RepositoryLocalAssetRequest("LOCKED", null, false, false, false, false));

        assertThat(asset.getLocalAssetId()).isEqualTo("capability.playbook-main");
        assertThat(services.scriptRepository.findById("capability.script-main"))
                .get()
                .extracting(ScriptDefinition::getScope, ScriptDefinition::isEditable, ScriptDefinition::getRepositoryScriptId)
                .containsExactly(ScriptScope.REPOSITORY, false, "script-main");
        assertThat(services.scriptRepository.findById("capability.script-child")).isPresent();
        assertThat(services.scriptScheduleRepository.findAll())
                .extracting(ScriptSchedule::getScriptId)
                .contains("capability.script-main", "capability.script-child");
        assertThat(services.repositoryDefinitionRepository.findById("knowledge:capability:billing-docs")).isPresent();
        Playbook saved = services.playbookRepository.findById("capability.playbook-main").orElseThrow();
        assertThat(saved.getRepositoryIds()).containsExactly("knowledge:capability:billing-docs");
        assertThat(saved.getKnowledgeRefs().get(0).getRepositoryId()).isEqualTo("knowledge:capability:billing-docs");
        assertThat(saved.getScriptRefs().get(0).getScriptId()).isEqualTo("capability.script-main");
        assertThat(saved.getRelatedPlaybookRefs().get(0).getPlaybookId()).isEqualTo("capability.playbook-related");
        assertThat(services.playbookRepository.findById("capability.playbook-related")).isPresent();
        verify(services.pluginService).resolvePluginDependencies(
                eq("capability"),
                argThat(dependencies -> dependencies.stream().anyMatch(item -> "plugin-a".equals(item.getPluginId()))),
                eq(true),
                anyBoolean());
    }

    @Test
    void trackedPlaybookStillInstallsDependenciesAsLockedAssets() throws Exception {
        TestServices services = createServices();
        Path repoRoot = createCapabilityRepository("tracked-repo");
        writeScript(repoRoot, "script-main", "1.0.0", List.of(), List.of(), false);
        writePlaybook(repoRoot, "playbook-main", "1.0.0",
                List.of(),
                List.of(),
                List.of(new PlaybookScriptRef().setScriptId("script-main")),
                List.of());
        services.repositoryDefinitionRepository.save(capabilityRepo("tracked-repo", repoRoot));
        RepositoryPlaybookService playbookService = createPlaybookService(services);

        RepositoryLocalAsset asset = playbookService.addLocalAsset("tracked-repo", "playbook-main",
                new RepositoryCatalogTypes.RepositoryLocalAssetRequest("TRACKED", "local-editable", false, false, false, false));

        assertThat(asset.getLocalAssetId()).isEqualTo("local-editable");
        assertThat(asset.getMode().name()).isEqualTo("TRACKED");
        assertThat(services.playbookRepository.findById("local-editable")).get().extracting(Playbook::isManaged).isEqualTo(false);
        assertThat(services.repositoryLocalAssetRepository
                .findByUpstreamAsset(UpstreamAssetType.SCRIPT, "tracked-repo", "script-main"))
                .get()
                .extracting(item -> item.getMode().name(), RepositoryLocalAsset::getLocalAssetId)
                .containsExactly("LOCKED", "tracked-repo.script-main");
        assertThat(services.playbookRepository.findById("local-editable").orElseThrow()
                .getScriptRefs().get(0).getScriptId()).isEqualTo("tracked-repo.script-main");
    }

    @Test
    void detectsRelatedPlaybookCycles() throws Exception {
        TestServices services = createServices();
        Path repoRoot = createCapabilityRepository("cycle-repo");
        writePlaybook(repoRoot, "playbook-a", "1.0.0",
                List.of(), List.of(), List.of(), List.of(new PlaybookRelatedRef().setPlaybookId("playbook-b")));
        writePlaybook(repoRoot, "playbook-b", "1.0.0",
                List.of(), List.of(), List.of(), List.of(new PlaybookRelatedRef().setPlaybookId("playbook-a")));
        services.repositoryDefinitionRepository.save(capabilityRepo("cycle-repo", repoRoot));
        RepositoryPlaybookService playbookService = createPlaybookService(services);

        assertThatThrownBy(() -> playbookService.addLocalAsset("cycle-repo", "playbook-a",
                new RepositoryCatalogTypes.RepositoryLocalAssetRequest("LOCKED", null, false, false, false, false)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("任务手册循环依赖")
                .hasMessageContaining("cycle-repo:playbook-a")
                .hasMessageContaining("cycle-repo:playbook-b");
    }

    private RepositoryPlaybookService createPlaybookService(TestServices services) {
        RepositoryCatalogService catalog = services.catalog();
        RepositoryScriptService scriptService = new RepositoryScriptService(
                catalog,
                services.pluginService,
                catalog.getRepos(),
                catalog.getServices(),
                catalog.getConfigTemplateSyncService()
        );
        RepositoryKnowledgeService knowledgeService = new RepositoryKnowledgeService(catalog);
        return new RepositoryPlaybookService(catalog, scriptService, knowledgeService);
    }

    private TestServices createServices() {
        TestServices services = new TestServices();
        AppProperties properties = new AppProperties();
        properties.setHomeDir(tempDir.resolve("home").toString());
        services.catalog = new RepositoryCatalogService(
                new RepositoryCatalogService.Repositories(
                        services.repositoryDefinitionRepository,
                        mock(CapabilityPackageInstallationRepository.class),
                        mock(ManagedSkillRepository.class),
                        services.scriptRepository,
                        services.scriptScheduleRepository,
                        mock(ExecutionPresetRepository.class),
                        mock(ConfigValueRepository.class),
                        mock(org.team4u.actiondock.domain.port.WebhookRepository.class),
                        services.repositoryLocalAssetRepository,
                        mock(org.team4u.actiondock.ai.api.AiModelProfileRepository.class),
                        mock(org.team4u.actiondock.ai.api.AiAgentProfileRepository.class),
                        mock(org.team4u.actiondock.ai.api.AiToolsetRepository.class),
                        services.playbookRepository
                ),
                new RepositoryCatalogService.ApplicationServices(null, ConfigValueApplicationService.disabled(), PluginRuntimeService.disabled()),
                jsonCodec,
                properties,
                null
        );
        return services;
    }

    private Path createCapabilityRepository(String repositoryId) throws Exception {
        Path repoRoot = tempDir.resolve(repositoryId);
        Files.createDirectories(repoRoot);
        writeIndex(repoRoot);
        return repoRoot;
    }

    private RepositoryDefinition capabilityRepo(String repositoryId, Path repoRoot) {
        return new RepositoryDefinition()
                .setId(repositoryId)
                .setName(repositoryId)
                .setType(REPO_TYPE_LOCAL_DIR)
                .setPurpose(REPO_PURPOSE_CAPABILITY)
                .setUrl(repoRoot.toString())
                .setEnabled(true)
                .setTrustLevel("TRUSTED");
    }

    private void writeScript(Path repoRoot,
                             String scriptId,
                             String version,
                             List<org.team4u.actiondock.domain.model.ScriptDependency> scriptDependencies,
                             List<PluginDependency> pluginDependencies,
                             boolean withSchedule) throws Exception {
        Path scriptDir = repoRoot.resolve("scripts").resolve(scriptId);
        Files.createDirectories(scriptDir);
        objectMapper.writeValue(scriptDir.resolve("script.json").toFile(), Map.ofEntries(
                Map.entry("scriptVersion", 1),
                Map.entry("id", scriptId),
                Map.entry("name", scriptId),
                Map.entry("version", version),
                Map.entry("type", "GROOVY"),
                Map.entry("packaging", "TOOL"),
                Map.entry("sourcePath", "source.groovy"),
                Map.entry("scheduleTemplatePath", withSchedule ? "schedules.json" : ""),
                Map.entry("scriptDependencies", scriptDependencies),
                Map.entry("pluginDependencies", pluginDependencies)
        ));
        Files.writeString(scriptDir.resolve("source.groovy"), "return [ok: true]");
        if (withSchedule) {
            objectMapper.writeValue(scriptDir.resolve("schedules.json").toFile(), List.of(Map.of(
                    "id", scriptId + "-daily",
                    "scriptId", scriptId,
                    "name", scriptId + " daily",
                    "cronExpression", "0 0 * * * *",
                    "input", Map.of(),
                    "enabledByDefault", true
            )));
        }
        writeIndex(repoRoot);
    }

    private void writeKnowledge(Path repoRoot, String knowledgeId) throws Exception {
        Path knowledgeDir = repoRoot.resolve("knowledge").resolve(knowledgeId);
        Files.createDirectories(knowledgeDir);
        Path projectDir = tempDir.resolve("project-" + knowledgeId);
        Files.createDirectories(projectDir);
        Files.writeString(projectDir.resolve("ACTIONDOCK.md"), "# " + knowledgeId);
        objectMapper.writeValue(knowledgeDir.resolve("knowledge.json").toFile(), Map.of(
                "schemaVersion", 1,
                "knowledgeId", knowledgeId,
                "displayName", knowledgeId,
                "source", Map.of(
                        "type", REPO_TYPE_LOCAL_DIR,
                        "url", projectDir.toString(),
                        "entryPath", "ACTIONDOCK.md"
                ),
                "tags", List.of()
        ));
        writeIndex(repoRoot);
    }

    private void writePlaybook(Path repoRoot,
                               String playbookId,
                               String version,
                               List<String> repositoryIds,
                               List<PlaybookKnowledgeRef> knowledgeRefs,
                               List<PlaybookScriptRef> scriptRefs,
                               List<PlaybookRelatedRef> relatedRefs) throws Exception {
        Path playbookDir = repoRoot.resolve("playbooks").resolve(playbookId);
        Files.createDirectories(playbookDir);
        objectMapper.writeValue(playbookDir.resolve("playbook.json").toFile(), Map.ofEntries(
                Map.entry("schemaVersion", 1),
                Map.entry("playbookId", playbookId),
                Map.entry("displayName", playbookId),
                Map.entry("version", version),
                Map.entry("tags", List.of()),
                Map.entry("repositoryIds", repositoryIds),
                Map.entry("knowledgeRefs", knowledgeRefs),
                Map.entry("scriptRefs", scriptRefs),
                Map.entry("agentSkillRefs", List.of()),
                Map.entry("relatedPlaybookRefs", relatedRefs),
                Map.entry("guideMarkdown", "guide"),
                Map.entry("stopConditions", List.of()),
                Map.entry("enabled", true)
        ));
        writeIndex(repoRoot);
    }

    private void writeIndex(Path repoRoot) throws Exception {
        Files.createDirectories(repoRoot.resolve("scripts"));
        Files.createDirectories(repoRoot.resolve("knowledge"));
        Files.createDirectories(repoRoot.resolve("playbooks"));
        List<Map<String, Object>> scripts = Files.list(repoRoot.resolve("scripts"))
                .filter(Files::isDirectory)
                .map(path -> Map.<String, Object>of(
                        "id", path.getFileName().toString(),
                        "name", path.getFileName().toString(),
                        "version", "1.0.0",
                        "type", "GROOVY",
                        "scriptPath", "scripts/" + path.getFileName() + "/script.json"
                ))
                .toList();
        List<Map<String, Object>> knowledge = Files.list(repoRoot.resolve("knowledge"))
                .filter(Files::isDirectory)
                .map(path -> Map.<String, Object>of(
                        "id", path.getFileName().toString(),
                        "name", path.getFileName().toString(),
                        "knowledgePath", "knowledge/" + path.getFileName() + "/knowledge.json",
                        "source", "GIT"
                ))
                .toList();
        List<Map<String, Object>> playbooks = Files.list(repoRoot.resolve("playbooks"))
                .filter(Files::isDirectory)
                .map(path -> Map.<String, Object>of(
                        "id", path.getFileName().toString(),
                        "name", path.getFileName().toString(),
                        "version", "1.0.0",
                        "playbookPath", "playbooks/" + path.getFileName() + "/playbook.json"
                ))
                .toList();
        objectMapper.writeValue(repoRoot.resolve("actiondock.repository.json").toFile(), Map.of(
                "repositoryVersion", 1,
                "name", "repo",
                "scripts", scripts,
                "knowledge", knowledge,
                "playbooks", playbooks
        ));
    }

    private static final class TestServices {
        private final InMemoryRepositoryDefinitionRepository repositoryDefinitionRepository = new InMemoryRepositoryDefinitionRepository();
        private final InMemoryRepositoryLocalAssetRepository repositoryLocalAssetRepository = new InMemoryRepositoryLocalAssetRepository();
        private final InMemoryScriptRepository scriptRepository = new InMemoryScriptRepository();
        private final InMemoryScriptScheduleRepository scriptScheduleRepository = new InMemoryScriptScheduleRepository();
        private final InMemoryPlaybookRepository playbookRepository = new InMemoryPlaybookRepository();
        private final RepositoryPluginService pluginService = mock(RepositoryPluginService.class);
        private RepositoryCatalogService catalog;

        private RepositoryCatalogService catalog() {
            return catalog;
        }
    }

    private static final class InMemoryRepositoryDefinitionRepository implements RepositoryDefinitionRepository {
        private final Map<String, RepositoryDefinition> items = new LinkedHashMap<>();

        @Override
        public RepositoryDefinition save(RepositoryDefinition registryDefinition) {
            items.put(registryDefinition.getId(), registryDefinition);
            return registryDefinition;
        }

        @Override
        public Optional<RepositoryDefinition> findById(String id) {
            return Optional.ofNullable(items.get(id));
        }

        @Override
        public List<RepositoryDefinition> findAll() {
            return List.copyOf(items.values());
        }

        @Override
        public void deleteById(String id) {
            items.remove(id);
        }
    }

    private static final class InMemoryRepositoryLocalAssetRepository implements RepositoryLocalAssetRepository {
        private final Map<String, RepositoryLocalAsset> items = new LinkedHashMap<>();

        @Override
        public RepositoryLocalAsset save(RepositoryLocalAsset asset) {
            items.put(asset.getId(), asset);
            return asset;
        }

        @Override
        public Optional<RepositoryLocalAsset> findById(String id) {
            return Optional.ofNullable(items.get(id));
        }

        @Override
        public Optional<RepositoryLocalAsset> findByLocalAsset(UpstreamAssetType assetType, String localAssetId) {
            return items.values().stream()
                    .filter(item -> item.getAssetType() == assetType)
                    .filter(item -> localAssetId.equals(item.getLocalAssetId()))
                    .findFirst();
        }

        @Override
        public Optional<RepositoryLocalAsset> findByUpstreamAsset(UpstreamAssetType assetType, String repositoryId, String upstreamAssetId) {
            return items.values().stream()
                    .filter(item -> item.getAssetType() == assetType)
                    .filter(item -> repositoryId.equals(item.getRepositoryId()))
                    .filter(item -> upstreamAssetId.equals(item.getUpstreamAssetId()))
                    .findFirst();
        }

        @Override
        public List<RepositoryLocalAsset> findAll() {
            return List.copyOf(items.values());
        }

        @Override
        public void deleteById(String id) {
            items.remove(id);
        }
    }

    private static final class InMemoryScriptRepository implements ScriptRepository {
        private final Map<String, ScriptDefinition> items = new LinkedHashMap<>();

        @Override
        public ScriptDefinition save(ScriptDefinition definition) {
            items.put(definition.getId(), definition);
            return definition;
        }

        @Override
        public Optional<ScriptDefinition> findById(String id) {
            return Optional.ofNullable(items.get(id));
        }

        @Override
        public List<ScriptDefinition> findAll() {
            return List.copyOf(items.values());
        }

        @Override
        public void deleteById(String id) {
            items.remove(id);
        }
    }

    private static final class InMemoryScriptScheduleRepository implements ScriptScheduleRepository {
        private final Map<String, ScriptSchedule> items = new LinkedHashMap<>();

        @Override
        public ScriptSchedule save(ScriptSchedule schedule) {
            items.put(schedule.getId(), schedule);
            return schedule;
        }

        @Override
        public Optional<ScriptSchedule> findById(String id) {
            return Optional.ofNullable(items.get(id));
        }

        @Override
        public List<ScriptSchedule> findAll() {
            return List.copyOf(items.values());
        }

        @Override
        public List<ScriptSchedule> findByScriptId(String scriptId) {
            return items.values().stream()
                    .filter(item -> scriptId.equals(item.getScriptId()))
                    .toList();
        }

        @Override
        public List<ScriptSchedule> findEnabled() {
            return items.values().stream()
                    .filter(ScriptSchedule::isEnabled)
                    .toList();
        }

        @Override
        public void deleteById(String id) {
            items.remove(id);
        }

        @Override
        public void deleteByScriptId(String scriptId) {
            items.values().removeIf(item -> scriptId.equals(item.getScriptId()));
        }
    }

    private static final class InMemoryPlaybookRepository implements PlaybookRepository {
        private final Map<String, Playbook> items = new LinkedHashMap<>();

        @Override
        public Playbook save(Playbook playbook) {
            items.put(playbook.getId(), playbook);
            return playbook;
        }

        @Override
        public Optional<Playbook> findById(String id) {
            return Optional.ofNullable(items.get(id));
        }

        @Override
        public List<Playbook> findAll() {
            return List.copyOf(items.values());
        }

        @Override
        public void deleteById(String id) {
            items.remove(id);
        }
    }

    private static final class TestJsonCodec implements JsonCodec {
        private final ObjectMapper objectMapper = new ObjectMapper();

        @Override
        public String write(Object value) {
            try {
                return value == null ? null : objectMapper.writeValueAsString(value);
            } catch (Exception exception) {
                throw new IllegalStateException(exception);
            }
        }

        @Override
        public <T> T read(String json, Class<T> type) {
            try {
                return objectMapper.readValue(json, type);
            } catch (Exception exception) {
                throw new IllegalStateException(exception);
            }
        }

        @Override
        public Object readUntyped(String json) {
            try {
                return objectMapper.readValue(json, Object.class);
            } catch (Exception exception) {
                throw new IllegalStateException(exception);
            }
        }

        @Override
        public <T> List<T> readList(String json, Class<T> elementType) {
            try {
                return objectMapper.readValue(json, objectMapper.getTypeFactory().constructCollectionType(List.class, elementType));
            } catch (Exception exception) {
                throw new IllegalStateException(exception);
            }
        }

        @Override
        public Map<String, Object> readMap(String json) {
            try {
                return objectMapper.readValue(json, objectMapper.getTypeFactory().constructMapType(Map.class, String.class, Object.class));
            } catch (Exception exception) {
                throw new IllegalStateException(exception);
            }
        }
    }
}
