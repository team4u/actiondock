package org.team4u.actiondock.skill;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.SkillInstallation;
import org.team4u.actiondock.domain.model.SkillTarget;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.SkillInstallationRepository;
import org.team4u.actiondock.domain.port.SkillTargetRepository;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SkillServiceTest {
    @TempDir
    Path tempDir;

    @Test
    void saveTargetExpandsTildePrefix() {
        SkillService service = createService();

        SkillTarget saved = service.saveTarget(new SkillTarget()
                .setName("Codex")
                .setType("CODEX")
                .setRootPath("~/.codex/skills"));

        assertThat(saved.getRootPath()).isEqualTo(Path.of(System.getProperty("user.home"), ".codex", "skills").toString());
        assertThat(saved.isWritable()).isTrue();
    }

    @Test
    void saveTargetAcceptsAbsolutePathsWithoutExpansion() {
        SkillService service = createService();
        Path path = tempDir.resolve("claude-skills");

        SkillTarget saved = service.saveTarget(new SkillTarget()
                .setName("Claude")
                .setType("CLAUDE")
                .setRootPath(path.toString()));

        assertThat(saved.getRootPath()).isEqualTo(path.toString());
    }

    @Test
    void saveTargetAcceptsAdditionalCliTypes() {
        SkillService service = createService();

        SkillTarget gemini = service.saveTarget(new SkillTarget()
                .setName("Gemini")
                .setType("GEMINI")
                .setRootPath(tempDir.resolve("gemini-skills").toString()));
        SkillTarget codebuddy = service.saveTarget(new SkillTarget()
                .setName("CodeBuddy")
                .setType("CODEBUDDY")
                .setRootPath(tempDir.resolve("codebuddy-skills").toString()));

        assertThat(gemini.getType()).isEqualTo("GEMINI");
        assertThat(codebuddy.getType()).isEqualTo("CODEBUDDY");
    }

    @Test
    void saveTargetRejectsNonTildeVariables() {
        SkillService service = createService();

        assertThatThrownBy(() -> service.saveTarget(new SkillTarget()
                .setName("Broken")
                .setType("CUSTOM")
                .setRootPath("${ACTIONDOCK_MISSING_TEST_VAR}/skills")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("仅支持使用 ~");
    }

    @Test
    void installFromDirectoryExpandsTilde() throws Exception {
        SkillService service = createService();
        Path homeSkillDir = Path.of(System.getProperty("user.home"), ".claude", "skills", "sample-skill");
        Files.createDirectories(homeSkillDir);
        Files.writeString(homeSkillDir.resolve("skill.json"), """
                {"schemaVersion":1,"skillId":"sample-skill","displayName":"Sample Skill","version":"1.0.0","description":"Sample","entrypoint":"SKILL.md"}
                """.trim());
        Files.writeString(homeSkillDir.resolve("SKILL.md"), """
                ---
                name: Sample Skill
                description: Sample
                ---

                Sample skill.
                """.trim());
        SkillTarget target = service.saveTarget(new SkillTarget()
                .setName("Claude")
                .setType("CLAUDE")
                .setRootPath(tempDir.resolve("target").toString()));

        SkillInstallation installation = service.installFromDirectory(target.getId(), "~/.claude/skills/sample-skill");

        assertThat(installation.getInstalledPath()).contains("sample-skill");
        assertThat(installation.getTargetPath()).isEqualTo(target.getRootPath());
    }

    @Test
    void installFromZipUsesArchiveBaseNameInsteadOfZipExtension() throws Exception {
        SkillService service = createService();
        SkillTarget target = service.saveTarget(new SkillTarget()
                .setName("Claude")
                .setType("CLAUDE")
                .setRootPath(tempDir.resolve("target").toString()));

        byte[] archive = createZip(Map.of(
                "actiondock-cli/SKILL.md", """
                        ---
                        name: ActionDock CLI
                        description: Manage ActionDock CLI.
                        ---

                        Sample skill.
                        """.trim(),
                "actiondock-cli/references/guide.md", "guide"
        ));

        SkillInstallation installation = service.installFromZip(target.getId(), "actiondock-cli.zip", archive);

        assertThat(installation.getSkillId()).isEqualTo("actiondock-cli");
        assertThat(installation.getInstalledPath()).endsWith("actiondock-cli");
        assertThat(installation.getInstalledPath()).doesNotContain(".zip");
        Path installedPath = Path.of(installation.getInstalledPath());
        assertThat(installedPath.resolve("SKILL.md")).exists();
        assertThat(installedPath.resolve("references").resolve("guide.md")).exists();
        assertThat(installedPath.resolve("actiondock-cli")).doesNotExist();
    }

    @Test
    void disableInstallationRemovesOnlyTargetDirectoryAndKeepsManagedCopy() throws Exception {
        SkillService service = createService();
        SkillTarget target = service.saveTarget(new SkillTarget()
                .setName("Claude")
                .setType("CLAUDE")
                .setRootPath(tempDir.resolve("target").toString()));

        byte[] archive = createZip(Map.of(
                "sample-skill/skill.json", """
                        {"schemaVersion":1,"skillId":"sample-skill","displayName":"Sample Skill","version":"1.0.0","description":"Sample","entrypoint":"SKILL.md"}
                        """.trim(),
                "sample-skill/SKILL.md", """
                        ---
                        name: Sample Skill
                        description: Sample
                        ---

                        Hello.
                        """.trim(),
                "sample-skill/references/guide.txt", "guide"
        ));

        SkillInstallation installation = service.installFromZip(target.getId(), "sample-skill.zip", archive);
        Path installedPath = Path.of(installation.getInstalledPath());
        Path managedPath = tempDir.resolve("managed-skills").resolve(target.getId()).resolve("sample-skill");

        SkillInstallation disabled = service.disableInstallation(installation.getInstallationId());

        assertThat(disabled.isEnabled()).isFalse();
        assertThat(installedPath).doesNotExist();
        assertThat(managedPath.resolve("SKILL.md")).exists();
        assertThat(service.getInstallationDetail(installation.getInstallationId()).files()).isNotEmpty();
    }

    @Test
    void restoreInstallationRecreatesTargetDirectoryAndMarksEnabled() throws Exception {
        SkillService service = createService();
        SkillTarget target = service.saveTarget(new SkillTarget()
                .setName("Claude")
                .setType("CLAUDE")
                .setRootPath(tempDir.resolve("target").toString()));

        byte[] archive = createZip(Map.of(
                "sample-skill/skill.json", """
                        {"schemaVersion":1,"skillId":"sample-skill","displayName":"Sample Skill","version":"1.0.0","description":"Sample","entrypoint":"SKILL.md"}
                        """.trim(),
                "sample-skill/SKILL.md", """
                        ---
                        name: Sample Skill
                        description: Sample
                        ---

                        Hello.
                        """.trim(),
                "sample-skill/references/guide.txt", "guide"
        ));

        SkillInstallation installation = service.installFromZip(target.getId(), "sample-skill.zip", archive);
        service.disableInstallation(installation.getInstallationId());

        SkillInstallation restored = service.restoreInstallation(installation.getInstallationId());

        assertThat(restored.isEnabled()).isTrue();
        Path restoredPath = Path.of(restored.getInstalledPath());
        assertThat(restoredPath.resolve("SKILL.md")).exists();
        assertThat(restoredPath.resolve("references").resolve("guide.txt")).exists();
    }

    @Test
    void restoreInstallationWorksWithoutSkillManifest() throws Exception {
        SkillService service = createService();
        SkillTarget target = service.saveTarget(new SkillTarget()
                .setName("Claude")
                .setType("CLAUDE")
                .setRootPath(tempDir.resolve("target").toString()));

        byte[] archive = createZip(Map.of(
                "sample-skill/SKILL.md", """
                        ---
                        name: Sample Skill
                        description: Sample
                        ---

                        Hello.
                        """.trim(),
                "sample-skill/references/guide.txt", "guide"
        ));

        SkillInstallation installation = service.installFromZip(target.getId(), "sample-skill.zip", archive);
        service.disableInstallation(installation.getInstallationId());

        SkillInstallation restored = service.restoreInstallation(installation.getInstallationId());

        assertThat(restored.isEnabled()).isTrue();
        assertThat(Path.of(restored.getInstalledPath()).resolve("SKILL.md")).exists();
    }

    @Test
    void syncInstallationsToTargetCreatesInstallationFromManagedCopy() throws Exception {
        SkillService service = createService();
        SkillTarget sourceTarget = service.saveTarget(new SkillTarget()
                .setName("Source")
                .setType("CLAUDE")
                .setRootPath(tempDir.resolve("source-target").toString()));
        SkillTarget target = service.saveTarget(new SkillTarget()
                .setName("Target")
                .setType("CODEX")
                .setRootPath(tempDir.resolve("target-root").toString()));

        byte[] archive = createZip(Map.of(
                "sample-skill/skill.json", """
                        {"schemaVersion":1,"skillId":"sample-skill","displayName":"Sample Skill","version":"1.0.0","description":"Sample","entrypoint":"SKILL.md"}
                        """.trim(),
                "sample-skill/SKILL.md", """
                        ---
                        name: Sample Skill
                        description: Sample
                        ---

                        Hello.
                        """.trim()
        ));

        SkillInstallation sourceInstallation = service.installFromZip(sourceTarget.getId(), "sample-skill.zip", archive);

        SkillService.SkillSyncResponse response = service.syncInstallationsToTarget(target.getId(), List.of(sourceInstallation.getInstallationId()));

        assertThat(response.targetId()).isEqualTo(target.getId());
        assertThat(response.results()).hasSize(1);
        SkillService.SkillSyncResult result = response.results().get(0);
        assertThat(result.status()).isEqualTo("SUCCESS");
        assertThat(result.createdInstallation()).isNotNull();
        assertThat(result.createdInstallation().getTargetId()).isEqualTo(target.getId());
        assertThat(Path.of(result.createdInstallation().getInstalledPath()).resolve("SKILL.md")).exists();
    }

    @Test
    void syncInstallationsToTargetSkipsUnmanagedConflicts() throws Exception {
        SkillService service = createService();
        SkillTarget sourceTarget = service.saveTarget(new SkillTarget()
                .setName("Source")
                .setType("CLAUDE")
                .setRootPath(tempDir.resolve("source-target").toString()));
        SkillTarget target = service.saveTarget(new SkillTarget()
                .setName("Target")
                .setType("CODEX")
                .setRootPath(tempDir.resolve("target-root").toString()));

        byte[] archive = createZip(Map.of(
                "sample-skill/skill.json", """
                        {"schemaVersion":1,"skillId":"sample-skill","displayName":"Sample Skill","version":"1.0.0","description":"Sample","entrypoint":"SKILL.md"}
                        """.trim(),
                "sample-skill/SKILL.md", """
                        ---
                        name: Sample Skill
                        description: Sample
                        ---

                        Hello.
                        """.trim()
        ));

        SkillInstallation sourceInstallation = service.installFromZip(sourceTarget.getId(), "sample-skill.zip", archive);
        Path unmanagedTargetDir = Path.of(target.getRootPath()).resolve("sample-skill");
        Files.createDirectories(unmanagedTargetDir);
        Files.writeString(unmanagedTargetDir.resolve("SKILL.md"), """
                ---
                name: Conflict Skill
                description: Conflict
                ---

                Conflict.
                """.trim());

        SkillService.SkillSyncResponse response = service.syncInstallationsToTarget(target.getId(), List.of(sourceInstallation.getInstallationId()));

        assertThat(response.results()).hasSize(1);
        assertThat(response.results().get(0).status()).isEqualTo("SKIPPED");
        assertThat(response.results().get(0).message()).contains("未受管目录");
        assertThat(service.listInstallations()).hasSize(1);
    }

    @Test
    void syncInstallationsToTargetOverwritesManagedInstallations() throws Exception {
        SkillService service = createService();
        SkillTarget sourceTarget = service.saveTarget(new SkillTarget()
                .setName("Source")
                .setType("CLAUDE")
                .setRootPath(tempDir.resolve("source-target").toString()));
        SkillTarget target = service.saveTarget(new SkillTarget()
                .setName("Target")
                .setType("CODEX")
                .setRootPath(tempDir.resolve("target-root").toString()));

        byte[] oldArchive = createZip(Map.of(
                "sample-skill/skill.json", """
                        {"schemaVersion":1,"skillId":"sample-skill","displayName":"Old Skill","version":"1.0.0","description":"Old","entrypoint":"SKILL.md"}
                        """.trim(),
                "sample-skill/SKILL.md", """
                        ---
                        name: Old Skill
                        description: Old
                        ---

                        old
                        """.trim()
        ));
        byte[] newArchive = createZip(Map.of(
                "sample-skill/skill.json", """
                        {"schemaVersion":1,"skillId":"sample-skill","displayName":"New Skill","version":"2.0.0","description":"New","entrypoint":"SKILL.md"}
                        """.trim(),
                "sample-skill/SKILL.md", """
                        ---
                        name: New Skill
                        description: New
                        ---

                        new
                        """.trim()
        ));

        SkillInstallation sourceInstallation = service.installFromZip(sourceTarget.getId(), "sample-skill.zip", newArchive);
        SkillInstallation targetInstallation = service.installFromZip(target.getId(), "sample-skill-old.zip", oldArchive);

        SkillService.SkillSyncResponse response = service.syncInstallationsToTarget(target.getId(), List.of(sourceInstallation.getInstallationId()));

        assertThat(response.results()).hasSize(1);
        assertThat(response.results().get(0).status()).isEqualTo("SUCCESS");
        SkillInstallation refreshed = service.getInstallation(targetInstallation.getInstallationId());
        assertThat(refreshed.getVersion()).isEqualTo("2.0.0");
        assertThat(refreshed.getDisplayName()).isEqualTo("New Skill");
    }

    @Test
    void previewInstallationFileRejectsTraversalAndSupportsTextPreview() throws Exception {
        SkillService service = createService();
        SkillTarget target = service.saveTarget(new SkillTarget()
                .setName("Claude")
                .setType("CLAUDE")
                .setRootPath(tempDir.resolve("target").toString()));

        byte[] archive = createZip(Map.of(
                "sample-skill/skill.json", """
                        {"schemaVersion":1,"skillId":"sample-skill","displayName":"Sample Skill","version":"1.0.0","description":"Sample","entrypoint":"SKILL.md"}
                        """.trim(),
                "sample-skill/SKILL.md", """
                        ---
                        name: Sample Skill
                        description: Sample
                        ---

                        Hello.
                        """.trim(),
                "sample-skill/references/guide.txt", "guide"
        ));

        SkillInstallation installation = service.installFromZip(target.getId(), "sample-skill.zip", archive);

        SkillService.SkillFilePreview preview = service.previewInstallationFile(installation.getInstallationId(), "references/guide.txt");

        assertThat(preview.previewType()).isEqualTo("TEXT");
        assertThat(preview.textContent()).isEqualTo("guide");
        assertThatThrownBy(() -> service.previewInstallationFile(installation.getInstallationId(), "../secret.txt"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("越界");
    }

    @Test
    void exportInstallationArchivePreservesReferencesAndAddsManifestDigest() throws Exception {
        SkillService service = createService();
        SkillTarget target = service.saveTarget(new SkillTarget()
                .setName("Claude")
                .setType("CLAUDE")
                .setRootPath(tempDir.resolve("target").toString()));

        byte[] archive = createZip(Map.of(
                "sample-skill/skill.json", """
                        {"schemaVersion":1,"skillId":"sample-skill","displayName":"Sample Skill","version":"1.0.0","description":"Sample","entrypoint":"SKILL.md"}
                        """.trim(),
                "sample-skill/SKILL.md", """
                        ---
                        name: Sample Skill
                        description: Sample
                        ---

                        Hello.
                        """.trim(),
                "sample-skill/references/guide.txt", "guide"
        ));

        SkillInstallation installation = service.installFromZip(target.getId(), "sample-skill.zip", archive);
        SkillService.SkillArchive exported = service.exportInstallationArchive(installation.getInstallationId());

        Map<String, String> files = unzip(exported.content());
        assertThat(files).containsKeys(
                "sample-skill/skill.json",
                "sample-skill/SKILL.md",
                "sample-skill/references/guide.txt"
        );
        assertThat(files.get("sample-skill/skill.json")).contains("\"digest\"");
        assertThat(files.get("sample-skill/references/guide.txt")).isEqualTo("guide");
    }

    @Test
    void installArchiveUsesArchiveManifestInsteadOfSeparateFields() throws Exception {
        SkillService service = createService();
        SkillTarget target = service.saveTarget(new SkillTarget()
                .setName("Claude")
                .setType("CLAUDE")
                .setRootPath(tempDir.resolve("target").toString()));

        byte[] archive = createZip(Map.of(
                "bundle/skill.json", """
                        {"schemaVersion":1,"skillId":"archive-skill","displayName":"Archive Skill","version":"2.1.0","description":"Archive","entrypoint":"SKILL.md"}
                        """.trim(),
                "bundle/SKILL.md", """
                        ---
                        name: Archive Skill
                        description: Archive
                        ---

                        Hello.
                        """.trim(),
                "bundle/references/guide.md", "# guide"
        ));

        SkillInstallation installation = service.installArchive(target.getId(), "repo-1", "bundle.zip", archive);

        assertThat(installation.getSkillId()).isEqualTo("archive-skill");
        assertThat(installation.getVersion()).isEqualTo("2.1.0");
        assertThat(installation.getRepositoryId()).isEqualTo("repo-1");
        assertThat(Path.of(installation.getInstalledPath()).resolve("references/guide.md")).exists();
    }

    private SkillService createService() {
        AppProperties properties = new AppProperties();
        properties.getSkills().setDir(tempDir.resolve("managed-skills").toString());
        return new SkillService(
                new InMemorySkillTargetRepository(),
                new InMemorySkillInstallationRepository(),
                new TestJsonCodec(),
                properties
        );
    }

    private byte[] createZip(Map<String, String> files) throws Exception {
        Path archive = tempDir.resolve("skill.zip");
        try (ZipOutputStream outputStream = new ZipOutputStream(Files.newOutputStream(archive))) {
            for (Map.Entry<String, String> entry : files.entrySet()) {
                outputStream.putNextEntry(new ZipEntry(entry.getKey()));
                outputStream.write(entry.getValue().getBytes());
                outputStream.closeEntry();
            }
        }
        return Files.readAllBytes(archive);
    }

    private Map<String, String> unzip(byte[] archive) throws Exception {
        Map<String, String> files = new LinkedHashMap<>();
        try (ZipInputStream inputStream = new ZipInputStream(new java.io.ByteArrayInputStream(archive))) {
            ZipEntry entry;
            while ((entry = inputStream.getNextEntry()) != null) {
                if (entry.isDirectory()) {
                    continue;
                }
                files.put(entry.getName(), new String(inputStream.readAllBytes()));
            }
        }
        return files;
    }

    private static final class InMemorySkillTargetRepository implements SkillTargetRepository {
        private final Map<String, SkillTarget> storage = new LinkedHashMap<>();

        @Override
        public SkillTarget save(SkillTarget target) {
            storage.put(target.getId(), target);
            return target;
        }

        @Override
        public Optional<SkillTarget> findById(String id) {
            return Optional.ofNullable(storage.get(id));
        }

        @Override
        public List<SkillTarget> findAll() {
            return storage.values().stream()
                    .sorted(Comparator.comparing(SkillTarget::getName, Comparator.nullsLast(String::compareToIgnoreCase)))
                    .toList();
        }

        @Override
        public void deleteById(String id) {
            storage.remove(id);
        }
    }

    private static final class InMemorySkillInstallationRepository implements SkillInstallationRepository {
        private final Map<String, SkillInstallation> storage = new LinkedHashMap<>();

        @Override
        public SkillInstallation save(SkillInstallation installation) {
            storage.put(installation.getInstallationId(), installation);
            return installation;
        }

        @Override
        public Optional<SkillInstallation> findByInstallationId(String installationId) {
            return Optional.ofNullable(storage.get(installationId));
        }

        @Override
        public List<SkillInstallation> findAll() {
            return new ArrayList<>(storage.values());
        }

        @Override
        public List<SkillInstallation> findBySkillId(String skillId) {
            return storage.values().stream()
                    .filter(item -> skillId.equals(item.getSkillId()))
                    .toList();
        }

        @Override
        public List<SkillInstallation> findByTargetId(String targetId) {
            return storage.values().stream()
                    .filter(item -> targetId.equals(item.getTargetId()))
                    .toList();
        }

        @Override
        public void deleteByInstallationId(String installationId) {
            storage.remove(installationId);
        }
    }

    private static final class TestJsonCodec implements JsonCodec {
        private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

        @Override
        public String write(Object value) {
            try {
                return objectMapper.writeValueAsString(value);
            } catch (JsonProcessingException exception) {
                throw new IllegalStateException(exception);
            }
        }

        @Override
        public <T> T read(String json, Class<T> type) {
            try {
                return objectMapper.readValue(json, type);
            } catch (JsonProcessingException exception) {
                throw new IllegalStateException(exception);
            }
        }

        @Override
        public Object readUntyped(String json) {
            try {
                return objectMapper.readValue(json, Object.class);
            } catch (JsonProcessingException exception) {
                throw new IllegalStateException(exception);
            }
        }

        @Override
        public <T> List<T> readList(String json, Class<T> elementType) {
            try {
                return objectMapper.readerForListOf(elementType).readValue(json);
            } catch (JsonProcessingException exception) {
                throw new IllegalStateException(exception);
            }
        }

        @Override
        public Map<String, Object> readMap(String json) {
            try {
                return objectMapper.readerForMapOf(Object.class).readValue(json);
            } catch (JsonProcessingException exception) {
                throw new IllegalStateException(exception);
            }
        }
    }
}
