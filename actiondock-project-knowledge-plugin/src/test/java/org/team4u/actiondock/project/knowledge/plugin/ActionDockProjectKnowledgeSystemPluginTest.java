package org.team4u.actiondock.project.knowledge.plugin;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.team4u.actiondock.plugin.api.PluginManifest;
import org.team4u.actiondock.plugin.api.PluginManifestLoader;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ActionDockProjectKnowledgeSystemPluginTest {

    @TempDir
    Path tempDir;

    private final ActionDockProjectKnowledgeSystemPlugin plugin = new ActionDockProjectKnowledgeSystemPlugin();

    @Test
    void manifestDocumentsPublicActions() {
        PluginManifest manifest = PluginManifestLoader.load(ActionDockProjectKnowledgeSystemPlugin.class, ActionDockProjectKnowledgeSystemPlugin.PLUGIN_ID);

        assertThat(manifest.getPluginId()).isEqualTo(ActionDockProjectKnowledgeSystemPlugin.PLUGIN_ID);
        assertThat(manifest.getActions())
                .extracting("action")
                .containsExactly("planMaintenance", "runMaintenance", "getRun", "validateKnowledge");
    }

    @Test
    void planMaintenanceDetectsOperationAndDomains() throws Exception {
        Files.writeString(tempDir.resolve("pom.xml"), "<project/>", StandardCharsets.UTF_8);

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("planMaintenance", null, Map.of("repoPath", tempDir.toString()));

        assertThat(result.get("status")).isEqualTo("PLANNED");
        assertThat(result.get("operation")).isEqualTo("init");
        assertThat((List<String>) result.get("activatedDomains")).contains("java", "actiondock");
        assertThat((List<String>) result.get("warnings")).contains("ACTIONDOCK.md is missing and will be initialized.");
    }

    @Test
    void runMaintenanceWritesEntryReportCheckpointAndOverview() throws Exception {
        Files.writeString(tempDir.resolve("pom.xml"), "<project/>", StandardCharsets.UTF_8);

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("runMaintenance", null, Map.of(
                "repoPath", tempDir.toString(),
                "operation", "init"
        ));

        assertThat(result.get("status")).isEqualTo("SUCCESS");
        assertThat(Files.exists(tempDir.resolve("ACTIONDOCK.md"))).isTrue();
        assertThat(Files.exists(tempDir.resolve("docs/project-knowledge-overview.md"))).isTrue();
        assertThat(Files.exists(tempDir.resolve("KNOWLEDGE_INIT_REPORT.md"))).isTrue();
        assertThat(Files.exists(tempDir.resolve(".knowledge-tmp/checkpoint.json"))).isTrue();
        assertThat(Files.readString(tempDir.resolve("ACTIONDOCK.md"))).contains("docs/project-knowledge-overview.md");
    }

    @Test
    void validateKnowledgeReportsMissingEntry() {
        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("validateKnowledge", null, Map.of("repoPath", tempDir.toString()));

        assertThat(result.get("ok")).isEqualTo(false);
        assertThat((List<Map<String, Object>>) result.get("issues"))
                .extracting("code")
                .contains("missing-entry");
    }

    @Test
    void getRunReturnsLatestCheckpoint() {
        @SuppressWarnings("unchecked")
        Map<String, Object> run = (Map<String, Object>) plugin.invoke("runMaintenance", null, Map.of("repoPath", tempDir.toString()));

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) plugin.invoke("getRun", null, Map.of("repoPath", tempDir.toString()));

        assertThat(result.get("status")).isEqualTo("FOUND");
        assertThat(result.get("content")).asString().contains((String) run.get("runId"));
    }
}
