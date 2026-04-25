package org.team4u.actiondock.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RepositoryCatalogServiceTest {
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void extractsLiteralPluginDependenciesFromGroovySource() {
        String source = """
                def first = plugins.invoke("plugin-a", "echo", [message: "hi"])
                def second = plugins.invoke('plugin-a', 'summarize')
                def ignored = plugins.invoke(input.pluginId, "dynamic")
                return plugins.invoke("plugin-b", "run")
                """;

        var dependencies = RepositoryCatalogService.extractPluginDependenciesFromSource(
                source,
                Map.of("plugin-a", "1.2.3", "plugin-b", "0.4.0")
        );

        assertThat(dependencies).hasSize(2);
        assertThat(dependencies.get(0).getPluginId()).isEqualTo("plugin-a");
        assertThat(dependencies.get(0).getVersionRange()).isEqualTo(">= 1.2.3");
        assertThat(dependencies.get(0).getRequiredActions()).containsExactly("echo", "summarize");
        assertThat(dependencies.get(1).getPluginId()).isEqualTo("plugin-b");
        assertThat(dependencies.get(1).getVersionRange()).isEqualTo(">= 0.4.0");
        assertThat(dependencies.get(1).getRequiredActions()).containsExactly("run");
    }

    @Test
    void repositoryMetadataKeepsAssetDescriptionSeparateFromReleaseNotes() throws Exception {
        String toolJson = """
                {
                  "toolVersion": 1,
                  "id": "demo-tool",
                  "name": "Demo Tool",
                  "version": "1.0.0",
                  "type": "GROOVY",
                  "description": "Asset docs",
                  "releaseNotes": "## Changed",
                  "tags": [],
                  "sourcePath": "source.groovy",
                  "inputSchemaPath": "input.schema.json",
                  "outputSchemaPath": "output.schema.json",
                  "pluginDependencies": []
                }
                """;

        RepositoryCatalogService.ToolFile tool = objectMapper.readValue(toolJson, RepositoryCatalogService.ToolFile.class);

        assertThat(tool.description()).isEqualTo("Asset docs");
        assertThat(tool.releaseNotes()).isEqualTo("## Changed");

        RepositoryCatalogService.PluginFile plugin = new RepositoryCatalogService.PluginFile(
                1,
                "demo-plugin",
                "Demo Plugin",
                "1.0.0",
                "Plugin docs",
                "Initial release",
                "team",
                List.of("demo"),
                "demo-plugin.jar",
                "sha",
                "LOW"
        );

        String pluginJson = objectMapper.writeValueAsString(plugin);

        assertThat(pluginJson).contains("\"description\":\"Plugin docs\"");
        assertThat(pluginJson).contains("\"releaseNotes\":\"Initial release\"");
    }

    @Test
    void repositoryMetadataReadsLegacyFilesWithoutReleaseNotes() throws Exception {
        String legacyIndexEntryJson = """
                {
                  "id": "demo-tool",
                  "name": "Demo Tool",
                  "version": "1.0.0",
                  "type": "GROOVY",
                  "description": "Asset docs",
                  "toolPath": "tools/demo-tool/tool.json"
                }
                """;

        RepositoryCatalogService.RepositoryIndexEntry entry = objectMapper.readValue(
                legacyIndexEntryJson,
                RepositoryCatalogService.RepositoryIndexEntry.class
        );

        assertThat(entry.description()).isEqualTo("Asset docs");
        assertThat(entry.releaseNotes()).isNull();
    }

    @Test
    void rejectsPublishingSameToolVersionInRepository() {
        RepositoryCatalogService.RepositoryIndexFile index = new RepositoryCatalogService.RepositoryIndexFile(
                1,
                "Demo Repository",
                null,
                List.of(new RepositoryCatalogService.RepositoryIndexEntry(
                        "demo-tool",
                        "Demo Tool",
                        "1.0.0",
                        "GROOVY",
                        null,
                        null,
                        "tools/demo-tool/tool.json"
                )),
                List.of()
        );

        assertThatThrownBy(() -> RepositoryCatalogService.assertToolVersionAvailable(
                "repo-1",
                index,
                "demo-tool",
                "1.0.0"
        ))
                .isInstanceOf(RepositoryCatalogService.RepositoryVersionExistsException.class)
                .hasMessage("工具版本已存在: demo-tool@1.0.0")
                .extracting("assetKind", "repositoryId", "assetId", "version")
                .containsExactly("TOOL", "repo-1", "demo-tool", "1.0.0");
    }

    @Test
    void allowsPublishingDifferentToolVersionOrDifferentTool() {
        RepositoryCatalogService.RepositoryIndexFile index = new RepositoryCatalogService.RepositoryIndexFile(
                1,
                "Demo Repository",
                null,
                List.of(new RepositoryCatalogService.RepositoryIndexEntry(
                        "demo-tool",
                        "Demo Tool",
                        "1.0.0",
                        "GROOVY",
                        null,
                        null,
                        "tools/demo-tool/tool.json"
                )),
                List.of()
        );

        assertThatCode(() -> RepositoryCatalogService.assertToolVersionAvailable("repo-1", index, "demo-tool", "1.0.1"))
                .doesNotThrowAnyException();
        assertThatCode(() -> RepositoryCatalogService.assertToolVersionAvailable("repo-1", index, "other-tool", "1.0.0"))
                .doesNotThrowAnyException();
    }

    @Test
    void rejectsPublishingSamePluginVersionInRepository() {
        RepositoryCatalogService.RepositoryIndexFile index = new RepositoryCatalogService.RepositoryIndexFile(
                1,
                "Demo Repository",
                null,
                List.of(),
                List.of(new RepositoryCatalogService.RepositoryPluginIndexEntry(
                        "demo-plugin",
                        "Demo Plugin",
                        "1.0.0",
                        null,
                        null,
                        "plugins/demo-plugin/plugin.json"
                ))
        );

        assertThatThrownBy(() -> RepositoryCatalogService.assertPluginVersionAvailable(
                "repo-1",
                index,
                "demo-plugin",
                "1.0.0"
        ))
                .isInstanceOf(RepositoryCatalogService.RepositoryVersionExistsException.class)
                .hasMessage("插件版本已存在: demo-plugin@1.0.0")
                .extracting("assetKind", "repositoryId", "assetId", "version")
                .containsExactly("PLUGIN", "repo-1", "demo-plugin", "1.0.0");
    }

    @Test
    void allowsPublishingDifferentPluginVersionOrDifferentPlugin() {
        RepositoryCatalogService.RepositoryIndexFile index = new RepositoryCatalogService.RepositoryIndexFile(
                1,
                "Demo Repository",
                null,
                List.of(),
                List.of(new RepositoryCatalogService.RepositoryPluginIndexEntry(
                        "demo-plugin",
                        "Demo Plugin",
                        "1.0.0",
                        null,
                        null,
                        "plugins/demo-plugin/plugin.json"
                ))
        );

        assertThatCode(() -> RepositoryCatalogService.assertPluginVersionAvailable("repo-1", index, "demo-plugin", "1.0.1"))
                .doesNotThrowAnyException();
        assertThatCode(() -> RepositoryCatalogService.assertPluginVersionAvailable("repo-1", index, "other-plugin", "1.0.0"))
                .doesNotThrowAnyException();
    }
}
