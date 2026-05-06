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

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;

class GithubSkillCollectionServiceTest {
    @TempDir
    Path tempDir;

    @Test
    void scanRepositoryRootUsesSkillsDirectoryByDefault() throws Exception {
        TestRuntime runtime = createRuntime(githubArchive(Map.of(
                "repo-main/skills/alpha/SKILL.md", skillMarkdown("Alpha Skill", "Alpha"),
                "repo-main/skills/beta/SKILL.md", skillMarkdown("Beta Skill", "Beta"),
                "repo-main/docs/not-a-skill/SKILL.md", skillMarkdown("Ignored Skill", "Ignored")
        )));

        GithubSkillCollectionService.GithubSkillScanResponse response = runtime.githubSkills.scan("https://github.com/acme/skills");

        assertThat(response.owner()).isEqualTo("acme");
        assertThat(response.repo()).isEqualTo("skills");
        assertThat(response.ref()).isEqualTo("main");
        assertThat(response.rootPath()).isEqualTo("skills");
        assertThat(response.skills()).extracting(GithubSkillCollectionService.GithubSkillScanItem::path)
                .containsExactly("skills/alpha", "skills/beta");
    }

    @Test
    void scanTreeUrlUsesRequestedDirectoryAndRef() throws Exception {
        TestRuntime runtime = createRuntime(githubArchive(Map.of(
                "repo-feature/collections/codex/alpha/SKILL.md", skillMarkdown("Alpha Skill", "Alpha"),
                "repo-feature/skills/beta/SKILL.md", skillMarkdown("Beta Skill", "Beta")
        )));

        GithubSkillCollectionService.GithubSkillScanResponse response = runtime.githubSkills.scan("https://github.com/acme/skills/tree/feature/collections/codex");

        assertThat(response.ref()).isEqualTo("feature");
        assertThat(response.rootPath()).isEqualTo("collections/codex");
        assertThat(response.skills()).extracting(GithubSkillCollectionService.GithubSkillScanItem::path)
                .containsExactly("collections/codex/alpha");
    }

    @Test
    void installInstallsSelectedSkillsAndReportsMissingPathFailure() throws Exception {
        TestRuntime runtime = createRuntime(githubArchive(Map.of(
                "repo-main/skills/alpha/skill.json", skillJson("alpha", "1.2.0", "Alpha Skill", "Alpha"),
                "repo-main/skills/alpha/SKILL.md", skillMarkdown("Alpha Skill", "Alpha"),
                "repo-main/skills/beta/SKILL.md", skillMarkdown("Beta Skill", "Beta")
        )));
        SkillTarget target = runtime.saveTarget("Codex", "CODEX", "target");

        GithubSkillCollectionService.GithubSkillInstallResponse response = runtime.githubSkills.install(
                "https://github.com/acme/skills",
                List.of(target.getId()),
                List.of("skills/alpha", "skills/missing")
        );

        assertThat(response.results()).extracting(GithubSkillCollectionService.GithubSkillInstallResult::status)
                .containsExactly("SUCCESS", "FAILED");
        assertThat(response.results().get(0).skillId()).isEqualTo("alpha");
        assertThat(response.results().get(0).skill().repositoryId()).isEqualTo("github:acme/skills#main");
        assertThat(Path.of(response.results().get(0).skill().targets().get(0).installedPath()).resolve("SKILL.md")).exists();
        assertThat(response.results().get(1).message()).contains("未找到");
    }

    private TestRuntime createRuntime(byte[] archive) {
        TestJsonCodec jsonCodec = new TestJsonCodec();
        AppProperties properties = new AppProperties();
        properties.getSkills().setDir(tempDir.resolve("managed-skills").toString());
        InMemorySkillTargetRepository targetRepository = new InMemorySkillTargetRepository();
        InMemorySkillInstallationRepository installationRepository = new InMemorySkillInstallationRepository();
        SkillService skillService = new SkillService(
                targetRepository,
                new InMemoryManagedSkillRepository(),
                installationRepository,
                jsonCodec,
                properties
        );
        GithubSkillCollectionService githubSkills = new GithubSkillCollectionService(
                skillService,
                jsonCodec,
                (owner, repo, ref) -> archive
        );
        SkillTargetService targetService = new SkillTargetService(
                targetRepository,
                installationRepository,
                skillService
        );
        return new TestRuntime(skillService, githubSkills, tempDir, targetService);
    }

    private byte[] githubArchive(Map<String, String> files) throws Exception {
        Path archive = tempDir.resolve("github.zip");
        try (ZipOutputStream outputStream = new ZipOutputStream(Files.newOutputStream(archive))) {
            for (Map.Entry<String, String> entry : files.entrySet()) {
                outputStream.putNextEntry(new ZipEntry(entry.getKey()));
                outputStream.write(entry.getValue().getBytes());
                outputStream.closeEntry();
            }
        }
        return Files.readAllBytes(archive);
    }

    private String skillMarkdown(String name, String description) {
        return """
                ---
                name: %s
                description: %s
                ---

                Body
                """.formatted(name, description).trim();
    }

    private String skillJson(String skillId, String version, String displayName, String description) {
        return """
                {"schemaVersion":1,"skillId":"%s","displayName":"%s","version":"%s","description":"%s","entrypoint":"SKILL.md"}
                """.formatted(skillId, displayName, version, description).trim();
    }

    private record TestRuntime(SkillService skillService, GithubSkillCollectionService githubSkills, Path root, SkillTargetService targetService) {
        private SkillTarget saveTarget(String name, String type, String folder) {
            return targetService.saveTarget(new SkillTarget()
                    .setName(name)
                    .setType(type)
                    .setRootPath(root.resolve(folder).toString()));
        }
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
