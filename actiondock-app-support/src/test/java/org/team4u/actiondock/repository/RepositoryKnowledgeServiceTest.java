package org.team4u.actiondock.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.RepositoryDefinitionRepository;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

class RepositoryKnowledgeServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final JsonCodec jsonCodec = new TestJsonCodec();
    @TempDir
    Path tempDir;

    private InMemoryRepositoryDefinitionRepository definitionRepository;
    private InMemoryConfigValueRepository configValueRepository;
    private RepositoryCatalogService catalogService;
    private RepositoryKnowledgeService knowledgeService;

    @BeforeEach
    void setUp() {
        definitionRepository = new InMemoryRepositoryDefinitionRepository();
        configValueRepository = new InMemoryConfigValueRepository();
        catalogService = new RepositoryCatalogService(
                new RepositoryCatalogService.Repositories(
                        definitionRepository,
                        mock(org.team4u.actiondock.domain.port.CapabilityPackageInstallationRepository.class),
                        mock(org.team4u.actiondock.domain.port.ManagedSkillRepository.class),
                        mock(org.team4u.actiondock.domain.port.ScriptRepository.class),
                        mock(org.team4u.actiondock.domain.port.ScriptScheduleRepository.class),
                        mock(org.team4u.actiondock.domain.port.ExecutionPresetRepository.class),
                        configValueRepository,
                        mock(org.team4u.actiondock.domain.port.WebhookRepository.class),
                        mock(org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository.class),
                        mock(org.team4u.actiondock.ai.api.AiModelProfileRepository.class),
                        mock(org.team4u.actiondock.ai.api.AiAgentProfileRepository.class),
                        mock(org.team4u.actiondock.ai.api.AiToolsetRepository.class)
                ),
                new RepositoryCatalogService.ApplicationServices(
                        mock(org.team4u.actiondock.application.ScriptApplicationService.class),
                        new org.team4u.actiondock.application.ConfigValueApplicationService(configValueRepository),
                        mock(org.team4u.actiondock.plugin.PluginRuntimeService.class)
                ),
                jsonCodec,
                new org.team4u.actiondock.config.AppProperties(),
                mock(org.team4u.actiondock.repository.PluginArtifactResolverRegistry.class)
        );
        knowledgeService = new RepositoryKnowledgeService(catalogService);
    }

    @Test
    void scansKnowledgeFromLocalDirRepository() throws Exception {
        Path repoRoot = tempDir.resolve("cap-repo");
        setupKnowledgeEntry(repoRoot, "product-api", "产品 API 文档", "接口规范",
                new KnowledgeSource(REPO_TYPE_GIT, "https://github.com/team/api-docs.git", "main", "ACTIONDOCK.md"),
                List.of("api", "docs"));

        RepositoryDefinition repo = createCapabilityRepo("cap-repo", repoRoot);

        List<RepositoryKnowledgeDescriptor> knowledge = knowledgeService.listRepositoryKnowledge("cap-repo");

        assertThat(knowledge).hasSize(1);
        assertThat(knowledge.get(0).knowledgeId()).isEqualTo("product-api");
        assertThat(knowledge.get(0).displayName()).isEqualTo("产品 API 文档");
        assertThat(knowledge.get(0).description()).isEqualTo("接口规范");
        assertThat(knowledge.get(0).tags()).containsExactly("api", "docs");
        assertThat(knowledge.get(0).source().type()).isEqualTo(REPO_TYPE_GIT);
        assertThat(knowledge.get(0).source().url()).isEqualTo("https://github.com/team/api-docs.git");
        assertThat(knowledge.get(0).installed()).isFalse();
    }

    @Test
    void scansMultipleKnowledgeEntries() throws Exception {
        Path repoRoot = tempDir.resolve("multi-repo");
        setupKnowledgeEntry(repoRoot, "docs-a", "文档 A", "描述 A",
                new KnowledgeSource(REPO_TYPE_GIT, "https://example.com/a.git", null, null), List.of());
        setupKnowledgeEntry(repoRoot, "docs-b", "文档 B", "描述 B",
                new KnowledgeSource(REPO_TYPE_LOCAL_DIR, "/local/path", null, "README.md"), List.of("local"));

        createCapabilityRepo("multi-repo", repoRoot);

        List<RepositoryKnowledgeDescriptor> knowledge = knowledgeService.listRepositoryKnowledge("multi-repo");

        assertThat(knowledge).hasSize(2);
        assertThat(knowledge).anySatisfy(k -> {
            assertThat(k.knowledgeId()).isEqualTo("docs-a");
            assertThat(k.source().type()).isEqualTo(REPO_TYPE_GIT);
        });
        assertThat(knowledge).anySatisfy(k -> {
            assertThat(k.knowledgeId()).isEqualTo("docs-b");
            assertThat(k.source().type()).isEqualTo(REPO_TYPE_LOCAL_DIR);
        });
    }

    @Test
    void returnsEmptyWhenNoKnowledgeDir() throws Exception {
        Path repoRoot = tempDir.resolve("empty-repo");
        Files.createDirectories(repoRoot);
        RepositoryWorkspaceHelper.ensureRepositoryWorkspace(repoRoot,
                new RepositoryDefinition().setId("empty-repo").setName("Empty"), jsonCodec);

        createCapabilityRepo("empty-repo", repoRoot);

        List<RepositoryKnowledgeDescriptor> knowledge = knowledgeService.listRepositoryKnowledge("empty-repo");
        assertThat(knowledge).isEmpty();
    }

    @Test
    void listAllRepositoryKnowledgeAcrossRepos() throws Exception {
        Path repoA = tempDir.resolve("repo-a");
        Path repoB = tempDir.resolve("repo-b");
        setupKnowledgeEntry(repoA, "knowledge-a", "A 知识", "A 描述",
                new KnowledgeSource(REPO_TYPE_GIT, "https://a.com", null, null), List.of());
        setupKnowledgeEntry(repoB, "knowledge-b", "B 知识", "B 描述",
                new KnowledgeSource(REPO_TYPE_GIT, "https://b.com", null, null), List.of());

        createCapabilityRepo("repo-a", repoA);
        createCapabilityRepo("repo-b", repoB);

        List<RepositoryKnowledgeDescriptor> all = knowledgeService.listAllRepositoryKnowledge();
        assertThat(all).hasSize(2);
    }

    @Test
    void getRepositoryKnowledgeDetail() throws Exception {
        Path repoRoot = tempDir.resolve("detail-repo");
        setupKnowledgeEntry(repoRoot, "detail-k", "详情知识", "详情描述",
                new KnowledgeSource(REPO_TYPE_GIT, "https://detail.com", "develop", "INDEX.md"), List.of("detail"));

        createCapabilityRepo("detail-repo", repoRoot);

        RepositoryKnowledgeDetail detail = knowledgeService.getRepositoryKnowledge("detail-repo", "detail-k");

        assertThat(detail.descriptor().knowledgeId()).isEqualTo("detail-k");
        assertThat(detail.knowledge().knowledgeId()).isEqualTo("detail-k");
        assertThat(detail.knowledge().source().branch()).isEqualTo("develop");
        assertThat(detail.knowledge().source().entryPath()).isEqualTo("INDEX.md");
    }

    @Test
    void throwsWhenKnowledgeNotFound() throws Exception {
        Path repoRoot = tempDir.resolve("not-found-repo");
        Files.createDirectories(repoRoot);
        RepositoryWorkspaceHelper.ensureRepositoryWorkspace(repoRoot,
                new RepositoryDefinition().setId("not-found-repo").setName("NF"), jsonCodec);
        createCapabilityRepo("not-found-repo", repoRoot);

        assertThatThrownBy(() -> knowledgeService.getRepositoryKnowledge("not-found-repo", "nonexistent"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("仓库知识源不存在: nonexistent");
    }

    @Test
    void installKnowledgeRegistersProjectRepository() throws Exception {
        Path repoRoot = tempDir.resolve("install-repo");
        Path knowledgeTarget = tempDir.resolve("knowledge-target");
        Files.createDirectories(knowledgeTarget);
        Files.writeString(knowledgeTarget.resolve("ACTIONDOCK.md"), "# Test Knowledge");

        setupKnowledgeEntry(repoRoot, "install-k", "安装知识", "安装描述",
                new KnowledgeSource(REPO_TYPE_LOCAL_DIR, knowledgeTarget.toString(), null, "ACTIONDOCK.md"), List.of());

        createCapabilityRepo("install-repo", repoRoot);

        RepositoryKnowledgeDescriptor result = knowledgeService.installKnowledge("install-repo", "install-k");

        assertThat(result.installed()).isTrue();
        assertThat(result.installedRepositoryId()).isEqualTo("knowledge:install-repo:install-k");

        RepositoryDefinition projectRepo = definitionRepository.findById("knowledge:install-repo:install-k").orElse(null);
        assertThat(projectRepo).isNotNull();
        assertThat(projectRepo.getPurpose()).isEqualTo(REPO_PURPOSE_PROJECT);
        assertThat(projectRepo.getType()).isEqualTo(REPO_TYPE_LOCAL_DIR);
        assertThat(projectRepo.getUrl()).isEqualTo(knowledgeTarget.toString());
        assertThat(projectRepo.getName()).isEqualTo("安装知识");
    }

    @Test
    void previewPublishDetectsConfigReferencesFromProjectRepositoryUrl() {
        configValueRepository.save(new ConfigValue()
                .setKey("git.token")
                .setValue("secret")
                .setSecret(true)
                .setDescription("Git Token"));
        definitionRepository.save(new RepositoryDefinition()
                .setId("project-repo")
                .setName("Project Repo")
                .setType(REPO_TYPE_GIT)
                .setPurpose(REPO_PURPOSE_PROJECT)
                .setUrl("https://${config.git.token}@github.com/team/project.git")
                .setEnabled(true));

        RepositoryPublishConfigPreview preview = knowledgeService.previewPublish(
                new RepositoryKnowledgePublishPreviewRequest("project-repo")
        );

        assertThat(preview.missingKeys()).isEmpty();
        assertThat(preview.items()).singleElement().satisfies(item -> {
            assertThat(item.key()).isEqualTo("git.token");
            assertThat(item.secret()).isTrue();
        });
    }

    @Test
    void publishKnowledgeWritesConfigTemplateAndKeepsSourceUrlTemplate() throws Exception {
        Path targetRepoRoot = tempDir.resolve("target-cap-repo");
        createCapabilityRepo("target-cap", targetRepoRoot);
        configValueRepository.save(new ConfigValue()
                .setKey("project.path")
                .setValue("/tmp/project")
                .setSecret(false)
                .setDescription("Project Path"));
        definitionRepository.save(new RepositoryDefinition()
                .setId("project-repo")
                .setName("Project Repo")
                .setType(REPO_TYPE_LOCAL_DIR)
                .setPurpose(REPO_PURPOSE_PROJECT)
                .setUrl("${config.project.path}")
                .setEnabled(true));

        RepositoryKnowledgeDescriptor descriptor = knowledgeService.publishKnowledge(
                "project-repo",
                "target-cap",
                new RepositoryKnowledgeService.PublishKnowledgeRequest(
                        "project-docs",
                        "Project Docs",
                        "Docs",
                        List.of("docs"),
                        List.of(new RepositoryPublishConfigItem("project.path", "INLINE"))
                )
        );
        RepositoryKnowledgeDetail detail = knowledgeService.getRepositoryKnowledge("target-cap", "project-docs");

        assertThat(descriptor.knowledgeId()).isEqualTo("project-docs");
        assertThat(detail.knowledge().source().url()).isEqualTo("${config.project.path}");
        assertThat(detail.knowledge().configTemplatePath()).isEqualTo(KNOWLEDGE_CONFIG_TEMPLATE_FILE);
        assertThat(detail.configTemplate()).singleElement().satisfies(item -> {
            assertThat(item.key()).isEqualTo("project.path");
            assertThat(item.defaultValue()).isEqualTo("/tmp/project");
        });
    }

    @Test
    void installKnowledgeSyncsConfigTemplateBeforeAutoSync() throws Exception {
        Path repoRoot = tempDir.resolve("config-install-repo");
        Path knowledgeTarget = tempDir.resolve("config-install-target");
        Files.createDirectories(knowledgeTarget);
        Files.writeString(knowledgeTarget.resolve("ACTIONDOCK.md"), "# Config Install");
        setupKnowledgeEntry(repoRoot, "config-k", "配置知识", "描述",
                new KnowledgeSource(REPO_TYPE_LOCAL_DIR, "${config.project.path}", null, null), List.of(),
                List.of(new ConfigTemplateItem("project.path", "Project Path", "string", false, false, knowledgeTarget.toString())));
        createCapabilityRepo("config-install-repo", repoRoot);

        knowledgeService.installKnowledge("config-install-repo", "config-k");

        ConfigValue synced = configValueRepository.findByKey("project.path").orElseThrow();
        assertThat(synced.isManaged()).isTrue();
        assertThat(synced.getValue()).isEqualTo(knowledgeTarget.toString());
        RepositoryDefinition projectRepo = definitionRepository.findById("knowledge:config-install-repo:config-k").orElseThrow();
        assertThat(projectRepo.getUrl()).isEqualTo("${config.project.path}");
        assertThat(projectRepo.getLastSyncedAt()).isNotNull();
    }

    @Test
    void installKnowledgeThrowsWhenAlreadyInstalled() throws Exception {
        Path repoRoot = tempDir.resolve("dup-repo");
        Path knowledgeTarget = tempDir.resolve("dup-target");
        Files.createDirectories(knowledgeTarget);
        Files.writeString(knowledgeTarget.resolve("ACTIONDOCK.md"), "# Dup");

        setupKnowledgeEntry(repoRoot, "dup-k", "重复知识", "重复描述",
                new KnowledgeSource(REPO_TYPE_LOCAL_DIR, knowledgeTarget.toString(), null, null), List.of());

        createCapabilityRepo("dup-repo", repoRoot);

        knowledgeService.installKnowledge("dup-repo", "dup-k");

        assertThatThrownBy(() -> knowledgeService.installKnowledge("dup-repo", "dup-k"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("知识源已安装: dup-k");
    }

    @Test
    void uninstallKnowledgeRemovesProjectRepository() throws Exception {
        Path repoRoot = tempDir.resolve("uninstall-repo");
        Path knowledgeTarget = tempDir.resolve("uninstall-target");
        Files.createDirectories(knowledgeTarget);
        Files.writeString(knowledgeTarget.resolve("ACTIONDOCK.md"), "# Uninstall");

        setupKnowledgeEntry(repoRoot, "uninstall-k", "卸载知识", "卸载描述",
                new KnowledgeSource(REPO_TYPE_LOCAL_DIR, knowledgeTarget.toString(), null, null), List.of());

        createCapabilityRepo("uninstall-repo", repoRoot);

        knowledgeService.installKnowledge("uninstall-repo", "uninstall-k");
        assertThat(definitionRepository.findById("knowledge:uninstall-repo:uninstall-k")).isPresent();

        knowledgeService.uninstallKnowledge("uninstall-repo", "uninstall-k");
        assertThat(definitionRepository.findById("knowledge:uninstall-repo:uninstall-k")).isEmpty();
    }

    @Test
    void uninstallKnowledgeThrowsWhenNotInstalled() throws Exception {
        Path repoRoot = tempDir.resolve("not-installed-repo");
        setupKnowledgeEntry(repoRoot, "not-installed-k", "未安装知识", "描述",
                new KnowledgeSource(REPO_TYPE_GIT, "https://example.com", null, null), List.of());

        createCapabilityRepo("not-installed-repo", repoRoot);

        assertThatThrownBy(() -> knowledgeService.uninstallKnowledge("not-installed-repo", "not-installed-k"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("知识源未安装: not-installed-k");
    }

    @Test
    void reflectsInstalledStatusInListing() throws Exception {
        Path repoRoot = tempDir.resolve("status-repo");
        Path knowledgeTarget = tempDir.resolve("status-target");
        Files.createDirectories(knowledgeTarget);
        Files.writeString(knowledgeTarget.resolve("ACTIONDOCK.md"), "# Status");

        setupKnowledgeEntry(repoRoot, "status-k", "状态知识", "描述",
                new KnowledgeSource(REPO_TYPE_LOCAL_DIR, knowledgeTarget.toString(), null, null), List.of());

        createCapabilityRepo("status-repo", repoRoot);

        List<RepositoryKnowledgeDescriptor> before = knowledgeService.listRepositoryKnowledge("status-repo");
        assertThat(before.get(0).installed()).isFalse();

        knowledgeService.installKnowledge("status-repo", "status-k");

        List<RepositoryKnowledgeDescriptor> after = knowledgeService.listRepositoryKnowledge("status-repo");
        assertThat(after.get(0).installed()).isTrue();
        assertThat(after.get(0).installedRepositoryId()).isEqualTo("knowledge:status-repo:status-k");
    }

    @Test
    void installedRepositoryIdFormat() {
        String id = RepositoryKnowledgeService.buildInstalledRepositoryId("my-repo", "my-knowledge");
        assertThat(id).isEqualTo("knowledge:my-repo:my-knowledge");
    }

    @Test
    void trustedRepositoryInheritsTrustLevel() throws Exception {
        Path repoRoot = tempDir.resolve("trust-repo");
        Path knowledgeTarget = tempDir.resolve("trust-target");
        Files.createDirectories(knowledgeTarget);
        Files.writeString(knowledgeTarget.resolve("ACTIONDOCK.md"), "# Trust");

        setupKnowledgeEntry(repoRoot, "trust-k", "信任知识", "描述",
                new KnowledgeSource(REPO_TYPE_LOCAL_DIR, knowledgeTarget.toString(), null, null), List.of());

        RepositoryDefinition repo = createCapabilityRepo("trust-repo", repoRoot);
        repo.setTrustLevel(REPO_TRUST_TRUSTED);
        definitionRepository.save(repo);

        knowledgeService.installKnowledge("trust-repo", "trust-k");

        RepositoryDefinition projectRepo = definitionRepository.findById("knowledge:trust-repo:trust-k").orElse(null);
        assertThat(projectRepo).isNotNull();
        assertThat(projectRepo.getTrustLevel()).isEqualTo(REPO_TRUST_TRUSTED);
    }

    @Test
    void scanKnowledgeSkipsInvalidManifest() throws Exception {
        Path repoRoot = tempDir.resolve("invalid-repo");
        Path knowledgeDir = repoRoot.resolve(KNOWLEDGE_DIR).resolve("bad-entry");
        Files.createDirectories(knowledgeDir);
        Files.writeString(knowledgeDir.resolve(KNOWLEDGE_MANIFEST_FILE), "not valid json {{{");

        createCapabilityRepo("invalid-repo", repoRoot);

        List<RepositoryKnowledgeDescriptor> knowledge = knowledgeService.listRepositoryKnowledge("invalid-repo");
        assertThat(knowledge).isEmpty();
    }

    private RepositoryDefinition createCapabilityRepo(String id, Path localPath) {
        RepositoryDefinition repo = new RepositoryDefinition()
                .setId(id)
                .setName(id)
                .setType(REPO_TYPE_LOCAL_DIR)
                .setPurpose(REPO_PURPOSE_CAPABILITY)
                .setUrl(localPath.toString())
                .setEnabled(true)
                .setTrustLevel(REPO_TRUST_UNTRUSTED);
        return definitionRepository.save(repo);
    }

    private void setupKnowledgeEntry(Path repoRoot, String knowledgeId, String displayName,
                                       String description, KnowledgeSource source, List<String> tags) throws Exception {
        setupKnowledgeEntry(repoRoot, knowledgeId, displayName, description, source, tags, List.of());
    }

    private void setupKnowledgeEntry(Path repoRoot, String knowledgeId, String displayName,
                                       String description, KnowledgeSource source, List<String> tags,
                                       List<ConfigTemplateItem> configTemplate) throws Exception {
        Path knowledgeDir = repoRoot.resolve(KNOWLEDGE_DIR).resolve(knowledgeId);
        Files.createDirectories(knowledgeDir);

        KnowledgeFile knowledgeFile = new KnowledgeFile(
                1,
                knowledgeId,
                displayName,
                description,
                source,
                tags,
                configTemplate.isEmpty() ? null : KNOWLEDGE_CONFIG_TEMPLATE_FILE
        );
        Files.writeString(knowledgeDir.resolve(KNOWLEDGE_MANIFEST_FILE), objectMapper.writeValueAsString(knowledgeFile));
        if (!configTemplate.isEmpty()) {
            Files.writeString(knowledgeDir.resolve(KNOWLEDGE_CONFIG_TEMPLATE_FILE), objectMapper.writeValueAsString(configTemplate));
        }
    }

    private static final class TestJsonCodec implements JsonCodec {
        private final ObjectMapper objectMapper = new ObjectMapper();

        @Override
        public String write(Object value) {
            try { return value == null ? null : objectMapper.writeValueAsString(value); }
            catch (Exception e) { throw new IllegalStateException("Cannot serialize", e); }
        }

        @Override
        public <T> T read(String json, Class<T> type) {
            try { return json == null || json.isBlank() ? null : objectMapper.readValue(json, type); }
            catch (Exception e) { throw new IllegalStateException("Cannot deserialize", e); }
        }

        @Override
        public Object readUntyped(String json) {
            try { return json == null || json.isBlank() ? null : objectMapper.readValue(json, Object.class); }
            catch (Exception e) { throw new IllegalStateException("Cannot deserialize", e); }
        }

        @Override
        public <T> List<T> readList(String json, Class<T> elementType) {
            try {
                if (json == null || json.isBlank()) return List.of();
                return objectMapper.readValue(json, objectMapper.getTypeFactory().constructCollectionType(java.util.ArrayList.class, elementType));
            } catch (Exception e) { throw new IllegalStateException("Cannot deserialize list", e); }
        }

        @Override
        public Map<String, Object> readMap(String json) {
            try {
                if (json == null || json.isBlank()) return Map.of();
                return objectMapper.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
            } catch (Exception e) { throw new IllegalStateException("Cannot deserialize map", e); }
        }
    }

    private static class InMemoryRepositoryDefinitionRepository implements RepositoryDefinitionRepository {
        private final Map<String, RepositoryDefinition> store = new HashMap<>();
        private long counter = 0;

        @Override
        public RepositoryDefinition save(RepositoryDefinition entity) {
            if (entity.getId() == null) {
                entity.setId("auto-" + (++counter));
            }
            store.put(entity.getId(), entity);
            return entity;
        }

        @Override
        public Optional<RepositoryDefinition> findById(String id) {
            return Optional.ofNullable(store.get(id));
        }

        @Override
        public List<RepositoryDefinition> findAll() {
            return new ArrayList<>(store.values());
        }

        @Override
        public void deleteById(String id) {
            store.remove(id);
        }
    }

    private static class InMemoryConfigValueRepository implements ConfigValueRepository {
        private final Map<String, ConfigValue> store = new HashMap<>();

        @Override
        public ConfigValue save(ConfigValue configValue) {
            store.put(configValue.getKey(), configValue.copy());
            return configValue.copy();
        }

        @Override
        public Optional<ConfigValue> findByKey(String key) {
            return Optional.ofNullable(store.get(key)).map(ConfigValue::copy);
        }

        @Override
        public List<ConfigValue> findAll() {
            return store.values().stream().map(ConfigValue::copy).toList();
        }

        @Override
        public void deleteByKey(String key) {
            store.remove(key);
        }
    }
}
