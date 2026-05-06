package org.team4u.actiondock.skill;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ManagedSkill;
import org.team4u.actiondock.domain.model.SkillInstallation;
import org.team4u.actiondock.domain.model.SkillTarget;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ManagedSkillRepository;
import org.team4u.actiondock.domain.port.SkillInstallationRepository;
import org.team4u.actiondock.domain.port.SkillTargetRepository;

import static org.team4u.actiondock.skill.SkillTypes.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SkillServiceTest {
    @TempDir
    Path tempDir;

    @Test
    void saveTargetExpandsTildePrefix() {
        SkillService service = createService();

        SkillTarget saved = createTargetService(service).saveTarget(new SkillTarget()
                .setName("Codex")
                .setType("CODEX")
                .setRootPath("~/.codex/skills"));

        assertThat(saved.getRootPath()).isEqualTo(Path.of(System.getProperty("user.home"), ".codex", "skills").toString());
        assertThat(saved.isWritable()).isTrue();
    }

    @Test
    void installToMultipleTargetsCreatesSingleManagedSkillAndMultipleDeployments() throws Exception {
        SkillService service = createService();
        SkillTarget targetA = saveTarget(service, "Claude", "CLAUDE", "target-a");
        SkillTarget targetB = saveTarget(service, "Codex", "CODEX", "target-b");

        SkillTypes.SkillListItem skill = service.installFromZip(
                List.of(targetA.getId(), targetB.getId()),
                "sample-skill.zip",
                sampleArchive("sample-skill", "1.0.0", "Sample Skill", "Sample", "hello")
        );

        assertThat(skill.skillId()).isEqualTo("sample-skill");
        assertThat(skill.targets()).hasSize(2);
        assertThat(skill.enabledTargetCount()).isEqualTo(2);
        assertThat(tempDir.resolve("managed-skills").resolve("sample-skill").resolve("SKILL.md")).exists();
        assertThat(Path.of(skill.targets().get(0).installedPath()).resolve("SKILL.md")).exists();
        assertThat(service.listSkills()).hasSize(1);
    }

    @Test
    void updateSkillUpgradesAllTargetsFromSingleManagedCopy() throws Exception {
        SkillService service = createService();
        SkillTarget targetA = saveTarget(service, "Claude", "CLAUDE", "target-a");
        SkillTarget targetB = saveTarget(service, "Codex", "CODEX", "target-b");
        service.installFromZip(
                List.of(targetA.getId(), targetB.getId()),
                "sample-skill.zip",
                sampleArchive("sample-skill", "1.0.0", "Old Skill", "Old", "old")
        );

        Path updateDir = tempDir.resolve("update");
        writeSkillDirectory(updateDir, "sample-skill", "2.0.0", "New Skill", "New", "new");

        SkillTypes.SkillListItem updated = service.updateSkill("sample-skill", updateDir.toString());

        assertThat(updated.version()).isEqualTo("2.0.0");
        assertThat(updated.displayName()).isEqualTo("New Skill");
        assertThat(updated.targets()).allSatisfy(target ->
                assertThat(Files.readString(Path.of(target.installedPath()).resolve("SKILL.md"))).contains("new"));
    }

    @Test
    void updateSkillWithoutManifestKeepsExistingLocalVersion() throws Exception {
        SkillService service = createService();
        SkillTarget target = saveTarget(service, "Claude", "CLAUDE", "target-a");
        service.installFromZip(
                List.of(target.getId()),
                "sample-skill.zip",
                sampleArchive("sample-skill", "1.5.0", "Old Skill", "Old", "old")
        );

        Path updateDir = tempDir.resolve("standard-update");
        writeStandardSkillDirectory(updateDir, "New Skill", "New", "new");

        SkillTypes.SkillListItem updated = service.updateSkill("sample-skill", updateDir.toString());

        assertThat(updated.version()).isEqualTo("1.5.0");
        assertThat(updated.displayName()).isEqualTo("New Skill");
        assertThat(updated.targets()).allSatisfy(deployment -> {
            Path installedPath = Path.of(deployment.installedPath());
            assertThat(Files.readString(installedPath.resolve("SKILL.md"))).contains("new");
            assertThat(Files.readString(installedPath.resolve(".actiondock-skill-install.json"))).contains("\"version\":\"1.5.0\"");
            assertThat(Files.readString(installedPath.resolve("skill.json"))).contains("\"version\":\"1.5.0\"");
        });
        assertThat(Files.readString(tempDir.resolve("managed-skills").resolve("sample-skill").resolve("skill.json")))
                .contains("\"version\":\"1.5.0\"");
    }

    @Test
    void updateSkillVersionChangesManagedMetadataWithoutChangingSkillContent() throws Exception {
        SkillService service = createService();
        SkillTarget target = saveTarget(service, "Claude", "CLAUDE", "target-a");
        service.installFromZip(
                List.of(target.getId()),
                "sample-skill.zip",
                sampleArchive("sample-skill", "1.0.0", "Sample Skill", "Sample", "hello")
        );

        SkillTypes.SkillListItem updated = service.updateSkillVersion("sample-skill", "1.1.0");

        assertThat(updated.version()).isEqualTo("1.1.0");
        assertThat(updated.targets()).allSatisfy(deployment ->
                assertThat(Files.readString(Path.of(deployment.installedPath()).resolve(".actiondock-skill-install.json")))
                        .contains("\"version\":\"1.1.0\""));
        assertThat(updated.targets()).allSatisfy(deployment ->
                assertThat(Files.readString(Path.of(deployment.installedPath()).resolve("skill.json")))
                        .contains("\"version\":\"1.1.0\""));
        assertThat(Files.readString(tempDir.resolve("managed-skills").resolve("sample-skill").resolve("SKILL.md"))).contains("hello");
        assertThat(Files.readString(tempDir.resolve("managed-skills").resolve("sample-skill").resolve("skill.json")))
                .contains("\"version\":\"1.1.0\"");
    }

    @Test
    void installStandardSkillArchiveDoesNotRequireActionDockManifest() throws Exception {
        SkillService service = createService();
        SkillTarget target = saveTarget(service, "Claude", "CLAUDE", "target-a");

        SkillTypes.SkillListItem skill = service.installFromZip(
                List.of(target.getId()),
                "standard-skill.zip",
                standardArchive("standard-skill", "Standard Skill", "Standard", "body")
        );

        assertThat(skill.skillId()).isEqualTo("standard-skill");
        assertThat(skill.version()).isEqualTo("1.0.0");
        assertThat(Files.readString(tempDir.resolve("managed-skills").resolve("standard-skill").resolve("skill.json")))
                .contains("\"skillId\":\"standard-skill\"")
                .contains("\"version\":\"1.0.0\"");
    }

    @Test
    void disableAndRestoreOperateOnAllTargets() throws Exception {
        SkillService service = createService();
        SkillTarget targetA = saveTarget(service, "Claude", "CLAUDE", "target-a");
        SkillTarget targetB = saveTarget(service, "Codex", "CODEX", "target-b");
        service.installFromZip(
                List.of(targetA.getId(), targetB.getId()),
                "sample-skill.zip",
                sampleArchive("sample-skill", "1.0.0", "Sample Skill", "Sample", "hello")
        );

        SkillTypes.SkillListItem disabled = service.disableSkill("sample-skill");
        assertThat(disabled.enabledTargetCount()).isZero();
        assertThat(disabled.disabledTargetCount()).isEqualTo(2);
        assertThat(disabled.targets()).allSatisfy(target -> assertThat(Path.of(target.installedPath())).doesNotExist());

        SkillTypes.SkillListItem restored = service.restoreSkill("sample-skill");
        assertThat(restored.enabledTargetCount()).isEqualTo(2);
        assertThat(restored.targets()).allSatisfy(target -> assertThat(Path.of(target.installedPath()).resolve("SKILL.md")).exists());
    }

    @Test
    void syncSkillToTargetCreatesAdditionalDeploymentWithoutDuplicatingSkill() throws Exception {
        SkillService service = createService();
        SkillTarget source = saveTarget(service, "Claude", "CLAUDE", "source");
        SkillTarget target = saveTarget(service, "Codex", "CODEX", "target");
        service.installFromZip(
                List.of(source.getId()),
                "sample-skill.zip",
                sampleArchive("sample-skill", "1.0.0", "Sample Skill", "Sample", "hello")
        );

        SkillTypes.SkillSyncResponse response = createTargetService(service).syncSkillsToTarget(target.getId(), List.of("sample-skill"));

        assertThat(response.results()).hasSize(1);
        assertThat(response.results().get(0).status()).isEqualTo("SUCCESS");
        assertThat(response.results().get(0).createdDeployment()).isNotNull();
        assertThat(service.getSkill("sample-skill").targets()).hasSize(2);
    }

    @Test
    void syncSkillToTargetSkipsUnmanagedConflict() throws Exception {
        SkillService service = createService();
        SkillTarget source = saveTarget(service, "Claude", "CLAUDE", "source");
        SkillTarget target = saveTarget(service, "Codex", "CODEX", "target");
        service.installFromZip(
                List.of(source.getId()),
                "sample-skill.zip",
                sampleArchive("sample-skill", "1.0.0", "Sample Skill", "Sample", "hello")
        );
        Path unmanagedTargetDir = Path.of(target.getRootPath()).resolve("sample-skill");
        Files.createDirectories(unmanagedTargetDir);
        Files.writeString(unmanagedTargetDir.resolve("SKILL.md"), """
                ---
                name: Conflict Skill
                description: Conflict
                ---

                conflict
                """.trim());

        SkillTypes.SkillSyncResponse response = createTargetService(service).syncSkillsToTarget(target.getId(), List.of("sample-skill"));

        assertThat(response.results()).hasSize(1);
        assertThat(response.results().get(0).status()).isEqualTo("SKIPPED");
        assertThat(response.results().get(0).message()).contains("未受管目录");
    }

    @Test
    void removeSkillFromTargetDeletesOnlyOneDeploymentUntilLastTarget() throws Exception {
        SkillService service = createService();
        SkillTarget targetA = saveTarget(service, "Claude", "CLAUDE", "target-a");
        SkillTarget targetB = saveTarget(service, "Codex", "CODEX", "target-b");
        service.installFromZip(
                List.of(targetA.getId(), targetB.getId()),
                "sample-skill.zip",
                sampleArchive("sample-skill", "1.0.0", "Sample Skill", "Sample", "hello")
        );

        service.removeSkillFromTarget("sample-skill", targetA.getId());
        assertThat(service.getSkill("sample-skill").targets()).hasSize(1);
        assertThat(tempDir.resolve("managed-skills").resolve("sample-skill").resolve("SKILL.md")).exists();

        service.removeSkillFromTarget("sample-skill", targetB.getId());
        assertThatThrownBy(() -> service.getSkill("sample-skill"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Skill 不存在");
        assertThat(tempDir.resolve("managed-skills").resolve("sample-skill")).doesNotExist();
    }

    @Test
    void previewAndExportUseSingleManagedCopy() throws Exception {
        SkillService service = createService();
        SkillTarget target = saveTarget(service, "Claude", "CLAUDE", "target-a");
        service.installFromZip(
                List.of(target.getId()),
                "sample-skill.zip",
                sampleArchive("sample-skill", "1.0.0", "Sample Skill", "Sample", "guide")
        );

        SkillTypes.SkillFilePreview preview = service.previewSkillFile("sample-skill", "references/guide.txt");
        SkillTypes.SkillArchive exported = service.exportSkillArchive("sample-skill");

        assertThat(preview.previewType()).isEqualTo("TEXT");
        assertThat(preview.textContent()).isEqualTo("guide");
        assertThat(unzip(exported.content())).containsKeys(
                "sample-skill/skill.json",
                "sample-skill/SKILL.md",
                "sample-skill/references/guide.txt"
        );
    }

    @Test
    void runtimeSkillReadsManagedContentAndTextResourcesOnlyWhenEnabled() throws Exception {
        SkillService service = createService();
        SkillTarget target = saveTarget(service, "ActionDock Agent", "ACTIONDOCK_AGENT", "target-a");
        service.installFromZip(
                List.of(target.getId()),
                "sample-skill.zip",
                sampleArchive("sample-skill", "1.0.0", "Sample Skill", "Sample", "guide")
        );
        Files.write(tempDir.resolve("managed-skills").resolve("sample-skill").resolve("image.png"), new byte[] {1, 2, 3});

        RuntimeSkill runtimeSkill = service.requireRuntimeSkill("sample-skill");

        assertThat(runtimeSkill.skillId()).isEqualTo("sample-skill");
        assertThat(runtimeSkill.displayName()).isEqualTo("Sample Skill");
        assertThat(runtimeSkill.skillContent()).contains("Sample Skill");
        assertThat(runtimeSkill.resources()).containsEntry("references/guide.txt", "guide");
        assertThat(runtimeSkill.resources()).doesNotContainKeys("SKILL.md", "skill.json", ".actiondock-skill-install.json", "image.png");

        service.disableSkill("sample-skill");
        assertThatThrownBy(() -> service.requireRuntimeSkill("sample-skill"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("未启用");
    }

    @Test
    void validateDirectoryStillRejectsTraversalPreview() throws Exception {
        SkillService service = createService();
        SkillTarget target = saveTarget(service, "Claude", "CLAUDE", "target-a");
        service.installFromZip(
                List.of(target.getId()),
                "sample-skill.zip",
                sampleArchive("sample-skill", "1.0.0", "Sample Skill", "Sample", "guide")
        );

        assertThatThrownBy(() -> service.previewSkillFile("sample-skill", "../secret.txt"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("越界");
    }

    private SkillTarget saveTarget(SkillService service, String name, String type, String folder) {
        return saveTarget(createTargetService(service), name, type, folder);
    }

    private SkillTarget saveTarget(SkillTargetService targetService, String name, String type, String folder) {
        return targetService.saveTarget(new SkillTarget()
                .setName(name)
                .setType(type)
                .setRootPath(tempDir.resolve(folder).toString()));
    }

    private final InMemorySkillTargetRepository targetRepository = new InMemorySkillTargetRepository();
    private final InMemorySkillInstallationRepository installationRepository = new InMemorySkillInstallationRepository();

    private SkillService createService() {
        AppProperties properties = new AppProperties();
        properties.getSkills().setDir(tempDir.resolve("managed-skills").toString());
        return new SkillService(
                targetRepository,
                new InMemoryManagedSkillRepository(),
                installationRepository,
                new TestJsonCodec(),
                properties
        );
    }

    private SkillTargetService createTargetService(SkillService skillService) {
        return new SkillTargetService(
                targetRepository,
                installationRepository,
                skillService
        );
    }

    private byte[] sampleArchive(String skillId,
                                 String version,
                                 String displayName,
                                 String description,
                                 String guideContent) throws Exception {
        return createZip(Map.of(
                skillId + "/skill.json", """
                        {"schemaVersion":1,"skillId":"%s","displayName":"%s","version":"%s","description":"%s","entrypoint":"SKILL.md"}
                        """.formatted(skillId, displayName, version, description).trim(),
                skillId + "/SKILL.md", """
                        ---
                        name: %s
                        description: %s
                        ---

                        %s
                        """.formatted(displayName, description, guideContent).trim(),
                skillId + "/references/guide.txt", guideContent
        ));
    }

    private void writeSkillDirectory(Path directory,
                                     String skillId,
                                     String version,
                                     String displayName,
                                     String description,
                                     String body) throws Exception {
        Files.createDirectories(directory);
        Files.writeString(directory.resolve("skill.json"), """
                {"schemaVersion":1,"skillId":"%s","displayName":"%s","version":"%s","description":"%s","entrypoint":"SKILL.md"}
                """.formatted(skillId, displayName, version, description).trim());
        Files.writeString(directory.resolve("SKILL.md"), """
                ---
                name: %s
                description: %s
                ---

                %s
                """.formatted(displayName, description, body).trim());
        Files.createDirectories(directory.resolve("references"));
        Files.writeString(directory.resolve("references/guide.txt"), body);
    }

    private void writeStandardSkillDirectory(Path directory,
                                             String displayName,
                                             String description,
                                             String body) throws Exception {
        Files.createDirectories(directory);
        Files.writeString(directory.resolve("SKILL.md"), """
                ---
                name: %s
                description: %s
                ---

                %s
                """.formatted(displayName, description, body).trim());
        Files.createDirectories(directory.resolve("references"));
        Files.writeString(directory.resolve("references/guide.txt"), body);
    }

    private byte[] standardArchive(String skillId,
                                   String displayName,
                                   String description,
                                   String body) throws Exception {
        return createZip(Map.of(
                skillId + "/SKILL.md", """
                        ---
                        name: %s
                        description: %s
                        ---

                        %s
                        """.formatted(displayName, description, body).trim(),
                skillId + "/references/guide.txt", body
        ));
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

    private static final class InMemoryManagedSkillRepository implements ManagedSkillRepository {
        private final Map<String, ManagedSkill> storage = new LinkedHashMap<>();

        @Override
        public ManagedSkill save(ManagedSkill skill) {
            storage.put(skill.getSkillId(), skill);
            return skill;
        }

        @Override
        public Optional<ManagedSkill> findBySkillId(String skillId) {
            return Optional.ofNullable(storage.get(skillId));
        }

        @Override
        public List<ManagedSkill> findAll() {
            return new ArrayList<>(storage.values());
        }

        @Override
        public void deleteBySkillId(String skillId) {
            storage.remove(skillId);
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
        public Optional<SkillInstallation> findBySkillIdAndTargetId(String skillId, String targetId) {
            return storage.values().stream()
                    .filter(item -> skillId.equals(item.getSkillId()) && targetId.equals(item.getTargetId()))
                    .findFirst();
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
        public void deleteBySkillIdAndTargetId(String skillId, String targetId) {
            storage.entrySet().removeIf(entry ->
                    skillId.equals(entry.getValue().getSkillId()) && targetId.equals(entry.getValue().getTargetId()));
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
