package org.team4u.actiondock.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.exception.RepositoryVersionExistsException;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.domain.port.CapabilityPackageInstallationRepository;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.ExecutionPresetRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ManagedSkillRepository;
import org.team4u.actiondock.domain.port.RepositoryDefinitionRepository;
import org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.plugin.PluginRuntimeService;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class RepositoryCatalogServiceTest {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final JsonCodec jsonCodec = new TestJsonCodec();

    @TempDir
    Path tempDir;

    @Test
    void ensureRepositoryWorkspaceCreatesFixedAssetDirectoriesOnly() throws Exception {
        Path root = tempDir.resolve("repo-root");
        RepositoryDefinition repository = new RepositoryDefinition()
                .setId("repo-1")
                .setName("Demo Repository")
                .setDescription("Demo description");

        RepositoryWorkspaceHelper.ensureRepositoryWorkspace(root, repository, jsonCodec);

        assertThat(Files.isDirectory(root.resolve("scripts"))).isTrue();
        assertThat(Files.isDirectory(root.resolve("webhooks"))).isTrue();
        assertThat(Files.isDirectory(root.resolve("plugins"))).isTrue();
        assertThat(Files.isDirectory(root.resolve("packages"))).isTrue();
        assertThat(Files.isDirectory(root.resolve("skills"))).isTrue();
        assertThat(Files.exists(root.resolve("actiondock.repository.json"))).isFalse();
    }

    @Test
    void ensureRepositoryWorkspaceDoesNotWriteRootIndexWhenNameMissing() throws Exception {
        Path root = tempDir.resolve("repo-without-name");
        RepositoryDefinition repository = new RepositoryDefinition()
                .setId("repo-2")
                .setDescription("Only description");

        RepositoryWorkspaceHelper.ensureRepositoryWorkspace(root, repository, jsonCodec);

        assertThat(Files.exists(root.resolve("actiondock.repository.json"))).isFalse();
        assertThat(Files.isDirectory(root.resolve("scripts"))).isTrue();
    }

    @Test
    void extractsLiteralPluginDependenciesFromGroovySource() {
        String source = """
                def first = plugins.invoke("plugin-a", "echo", [message: "hi"])
                def second = plugins.invoke('plugin-a', 'summarize')
                def ignored = plugins.invoke(input.pluginId, "dynamic")
                return plugins.invoke("plugin-b", "run")
                """;

        var dependencies = ScriptRepositoryPublisher.extractPluginDependenciesFromSource(
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
    void extractsPluginDependenciesSkipsSystemPluginIds() {
        String source = """
                plugins.invoke("actiondock-ai", "chat", [:])
                plugins.invoke("actiondock-workspace", "viewTextFile", [path: "README.md"])
                plugins.invoke("plugin-a", "echo", [message: "hi"])
                """;

        var dependencies = ScriptRepositoryPublisher.extractPluginDependenciesFromSource(
                source,
                Map.of("plugin-a", "1.2.3"),
                Set.of("actiondock-ai", "actiondock-workspace")
        );

        assertThat(dependencies).singleElement().satisfies(dependency -> {
            assertThat(dependency.getPluginId()).isEqualTo("plugin-a");
            assertThat(dependency.getVersionRange()).isEqualTo(">= 1.2.3");
            assertThat(dependency.getRequiredActions()).containsExactly("echo");
        });
    }

    @Test
    void extractsLiteralPluginDependenciesFromPythonSource() {
        String source = """
                first = plugins.invoke("plugin-a", "echo", {"message": "hi"})
                second = plugins.invoke('plugin-a', 'summarize')
                ignored = plugins.invoke(plugin_id, "dynamic")
                return plugins.invoke("plugin-b", "run")
                """;

        var dependencies = ScriptRepositoryPublisher.extractPluginDependenciesFromSource(
                source,
                Map.of("plugin-a", "1.2.3", "plugin-b", "0.4.0")
        );

        assertThat(dependencies).hasSize(2);
        assertThat(dependencies.get(0).getPluginId()).isEqualTo("plugin-a");
        assertThat(dependencies.get(0).getRequiredActions()).containsExactly("echo", "summarize");
        assertThat(dependencies.get(1).getPluginId()).isEqualTo("plugin-b");
        assertThat(dependencies.get(1).getRequiredActions()).containsExactly("run");
    }

    @Test
    void repositoryMetadataKeepsAssetDescriptionSeparateFromReleaseNotes() throws Exception {
        String toolJson = """
                {
                  "scriptVersion": 1,
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

        ToolFile tool = objectMapper.readValue(toolJson, ToolFile.class);

        assertThat(tool.description()).isEqualTo("Asset docs");
        assertThat(tool.releaseNotes()).isEqualTo("## Changed");

        PluginFile plugin = new PluginFile(
                1,
                "demo-plugin",
                "Demo Plugin",
                "1.0.0",
                "Plugin docs",
                "Initial release",
                "team",
                List.of("demo"),
                new PluginArtifactRef("local://plugins/demo-plugin/demo-plugin.jar", "sha", "demo-plugin.jar", 123L),
                "LOW"
        );

        String pluginJson = objectMapper.writeValueAsString(plugin);

        assertThat(pluginJson).contains("\"description\":\"Plugin docs\"");
        assertThat(pluginJson).contains("\"releaseNotes\":\"Initial release\"");
        assertThat(pluginJson).contains("\"artifact\"");
        assertThat(pluginJson).contains("\"uri\":\"local://plugins/demo-plugin/demo-plugin.jar\"");
    }

    @Test
    void toolMetadataRoundTripsScriptDependencies() throws Exception {
        ToolFile tool = new ToolFile(
                1,
                "demo-tool",
                "Demo Tool",
                "1.0.0",
                "GROOVY",
                "TOOL",
                "Asset docs",
                "Initial",
                "team",
                List.of("demo"),
                "source.groovy",
                null,
                "input.schema.json",
                "output.schema.json",
                null,
                null,
                null,
                null,
                List.of(new org.team4u.actiondock.domain.model.ScriptDependency()
                        .setScriptId("child")
                        .setRepositoryId("repo-a")
                        .setToolId("child-tool")
                        .setVersionRange(">= 1.2.0")),
                List.of()
        );

        String json = objectMapper.writeValueAsString(tool);
        ToolFile restored = objectMapper.readValue(json, ToolFile.class);

        assertThat(restored.scriptDependencies()).singleElement()
                .satisfies(item -> {
                    assertThat(item.getScriptId()).isEqualTo("child");
                    assertThat(item.getRepositoryId()).isEqualTo("repo-a");
                    assertThat(item.getRepositoryScriptId()).isEqualTo("child-tool");
                    assertThat(item.getVersionRange()).isEqualTo(">= 1.2.0");
                });
    }

    @Test
    void toolMetadataRejectsLegacyToolIdField() {
        String toolJson = """
                {
                  "scriptVersion": 1,
                  "toolId": "legacy-tool",
                  "name": "Legacy Tool",
                  "version": "1.0.0",
                  "type": "GROOVY",
                  "sourcePath": "source.groovy",
                  "tags": [],
                  "pluginDependencies": []
                }
                """;

        assertThatThrownBy(() -> objectMapper.readValue(toolJson, ToolFile.class))
                .isInstanceOf(Exception.class);
    }

    @Test
    void repositoryMetadataAllowsMissingReleaseNotes() {
        String indexJson = """
                {
                  "repositoryVersion": 1,
                  "name": "Demo Repository",
                  "scripts": [
                    {
                      "id": "demo-tool",
                      "name": "Demo Tool",
                      "version": "1.0.0",
                      "type": "GROOVY",
                      "description": "Asset docs",
                      "scriptPath": "scripts/demo-tool/script.json"
                    }
                  ],
                  "plugins": []
                }
                """;
        String toolJson = """
                {
                  "scriptVersion": 1,
                  "id": "demo-tool",
                  "name": "Demo Tool",
                  "version": "1.0.0",
                  "type": "GROOVY",
                  "description": "Asset docs",
                  "tags": [],
                  "sourcePath": "source.groovy",
                  "inputSchemaPath": "input.schema.json",
                  "outputSchemaPath": "output.schema.json",
                  "pluginDependencies": []
                }
                """;
        String pluginJson = """
                {
                  "pluginFileVersion": 1,
                  "pluginId": "demo-plugin",
                  "name": "Demo Plugin",
                  "version": "1.0.0",
                  "description": "Plugin docs",
                  "owner": "team",
                  "tags": [],
                  "artifact": {
                    "uri": "local://plugins/demo-plugin/demo-plugin.jar"
                  },
                  "riskLevel": "LOW"
                }
                """;

        assertThatCode(() -> RepositoryWorkspaceHelper.assertLatestRepositoryMetadata(
                indexJson,
                RepositoryIndexFile.class,
                "actiondock.repository.json"
        )).doesNotThrowAnyException();
        assertThatCode(() -> RepositoryWorkspaceHelper.assertLatestRepositoryMetadata(
                toolJson,
                ToolFile.class,
                "script.json"
        )).doesNotThrowAnyException();
        assertThatCode(() -> RepositoryWorkspaceHelper.assertLatestRepositoryMetadata(
                pluginJson,
                PluginFile.class,
                "plugin.json"
        )).doesNotThrowAnyException();
    }

    @Test
    void repositoryMetadataAcceptsExplicitNullReleaseNotes() throws Exception {
        String indexJson = """
                {
                  "repositoryVersion": 1,
                  "name": "Demo Repository",
                  "scripts": [
                    {
                      "id": "demo-tool",
                      "name": "Demo Tool",
                      "version": "1.0.0",
                      "type": "GROOVY",
                      "description": "Asset docs",
                      "releaseNotes": null,
                      "scriptPath": "scripts/demo-tool/script.json"
                    }
                  ],
                  "plugins": []
                }
                """;
        String indexEntryJson = """
                {
                  "id": "demo-tool",
                  "name": "Demo Tool",
                  "version": "1.0.0",
                  "type": "GROOVY",
                  "description": "Asset docs",
                  "releaseNotes": null,
                  "scriptPath": "scripts/demo-tool/script.json"
                }
                """;
        String toolJson = """
                {
                  "scriptVersion": 1,
                  "id": "demo-tool",
                  "name": "Demo Tool",
                  "version": "1.0.0",
                  "type": "GROOVY",
                  "description": "Asset docs",
                  "releaseNotes": null,
                  "tags": [],
                  "sourcePath": "source.groovy",
                  "inputSchemaPath": "input.schema.json",
                  "outputSchemaPath": "output.schema.json",
                  "pluginDependencies": []
                }
                """;
        String pluginJson = """
                {
                  "pluginFileVersion": 1,
                  "pluginId": "demo-plugin",
                  "name": "Demo Plugin",
                  "version": "1.0.0",
                  "description": "Plugin docs",
                  "releaseNotes": null,
                  "owner": "team",
                  "tags": [],
                  "artifact": {
                    "uri": "local://plugins/demo-plugin/demo-plugin.jar"
                  },
                  "riskLevel": "LOW"
                }
                """;

        assertThatCode(() -> RepositoryWorkspaceHelper.assertLatestRepositoryMetadata(
                indexJson,
                RepositoryIndexFile.class,
                "actiondock.repository.json"
        )).doesNotThrowAnyException();
        assertThatCode(() -> RepositoryWorkspaceHelper.assertLatestRepositoryMetadata(
                toolJson,
                ToolFile.class,
                "tool.json"
        )).doesNotThrowAnyException();
        assertThatCode(() -> RepositoryWorkspaceHelper.assertLatestRepositoryMetadata(
                pluginJson,
                PluginFile.class,
                "plugin.json"
        )).doesNotThrowAnyException();

        RepositoryIndexEntry entry = objectMapper.readValue(
                indexEntryJson,
                RepositoryIndexEntry.class
        );
        assertThat(entry.description()).isEqualTo("Asset docs");
        assertThat(entry.releaseNotes()).isNull();
    }

    @Test
    void scansScriptDescriptorWithoutRootRepositoryIndex() throws Exception {
        Path repositoryRoot = tempDir.resolve("script-repo");
        Files.createDirectories(repositoryRoot.resolve("scripts/demo-script"));
        Files.writeString(repositoryRoot.resolve("scripts/demo-script/script.json"), """
                {
                  "scriptVersion": 1,
                  "id": "demo-script",
                  "name": "Demo Script",
                  "version": "1.0.0",
                  "type": "GROOVY",
                  "sourcePath": "source.groovy",
                  "tags": [],
                  "pluginDependencies": []
                }
                """);
        Files.writeString(repositoryRoot.resolve("scripts/demo-script/source.groovy"), "return [message: 'ok']");
        RepositoryDefinition repository = new RepositoryDefinition()
                .setId("script-repo")
                .setName("Script Repository")
                .setType(REPO_TYPE_LOCAL_DIR)
                .setPurpose(REPO_PURPOSE_CAPABILITY)
                .setUrl(repositoryRoot.toString())
                .setEnabled(true);
        RepositoryCatalogService service = new RepositoryCatalogService(
                repositories(List.of(repository)),
                new RepositoryCatalogService.ApplicationServices(null, null, PluginRuntimeService.disabled()),
                jsonCodec,
                appProperties(),
                null
        );

        List<RepositoryScriptDescriptor> scripts = service.listRepositoryScripts("script-repo");
        RepositoryScriptDetail detail = service.getRepositoryScript("script-repo", "demo-script");

        assertThat(scripts).singleElement().satisfies(item -> {
            assertThat(item.scriptId()).isEqualTo("demo-script");
            assertThat(item.sourcePath()).isEqualTo("source.groovy");
        });
        assertThat(detail.descriptor().scriptId()).isEqualTo("demo-script");
        assertThat(detail.source()).isEqualTo("return [message: 'ok']");
    }

    @Test
    void ignoresLegacyToolDescriptorWhenScriptDescriptorIsMissing() throws Exception {
        Path repositoryRoot = tempDir.resolve("legacy-tool-repo");
        Files.createDirectories(repositoryRoot.resolve("scripts/demo-tool"));
        Files.writeString(repositoryRoot.resolve("actiondock.repository.json"), """
                {
                  "repositoryVersion": 1,
                  "name": "Legacy Tool Repository",
                  "scripts": [
                    {
                      "id": "demo-tool",
                      "name": "Demo Tool",
                      "version": "1.0.0",
                      "type": "GROOVY",
                      "scriptPath": "scripts/demo-tool/script.json"
                    }
                  ],
                  "plugins": []
                }
                """);
        Files.writeString(repositoryRoot.resolve("scripts/demo-tool/tool.json"), """
                {
                  "scriptVersion": 1,
                  "id": "demo-tool",
                  "name": "Demo Tool",
                  "version": "1.0.0",
                  "type": "GROOVY",
                  "sourcePath": "source.groovy",
                  "tags": [],
                  "pluginDependencies": []
                }
                """);
        Files.writeString(repositoryRoot.resolve("scripts/demo-tool/source.groovy"), "return [message: 'ok']");
        RepositoryDefinition repository = new RepositoryDefinition()
                .setId("legacy-tool-repo")
                .setName("Legacy Tool Repository")
                .setType(REPO_TYPE_LOCAL_DIR)
                .setPurpose(REPO_PURPOSE_CAPABILITY)
                .setUrl(repositoryRoot.toString())
                .setEnabled(true);
        RepositoryCatalogService service = new RepositoryCatalogService(
                repositories(List.of(repository)),
                new RepositoryCatalogService.ApplicationServices(null, null, PluginRuntimeService.disabled()),
                jsonCodec,
                appProperties(),
                null
        );

        List<RepositoryScriptDescriptor> scripts = service.listRepositoryScripts("legacy-tool-repo");

        assertThat(scripts).isEmpty();
        assertThatThrownBy(() -> service.getRepositoryScript("legacy-tool-repo", "demo-tool"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("仓库工具不存在: demo-tool");
    }

    @Test
    void rejectsPublishingSameToolVersionInRepository() {
        RepositoryIndexFile index = new RepositoryIndexFile(
                1,
                "Demo Repository",
                null,
                List.of(new RepositoryIndexEntry(
                        "demo-tool",
                        "Demo Tool",
                        "1.0.0",
                        "GROOVY",
                        null,
                        null,
                        "tools/demo-tool/tool.json"
                )),
                List.of(),
                List.of()
        );

        assertThatThrownBy(() -> ScriptRepositoryPublisher.assertToolVersionAvailable(
                "repo-1",
                index,
                "demo-tool",
                "1.0.0"
        ))
                .isInstanceOf(RepositoryVersionExistsException.class)
                .hasMessage("工具版本已存在: demo-tool@1.0.0")
                .extracting("assetKind", "repositoryId", "assetId", "version")
                .containsExactly("TOOL", "repo-1", "demo-tool", "1.0.0");
    }

    @Test
    void allowsPublishingDifferentToolVersionOrDifferentTool() {
        RepositoryIndexFile index = new RepositoryIndexFile(
                1,
                "Demo Repository",
                null,
                List.of(new RepositoryIndexEntry(
                        "demo-tool",
                        "Demo Tool",
                        "1.0.0",
                        "GROOVY",
                        null,
                        null,
                        "tools/demo-tool/tool.json"
                )),
                List.of(),
                List.of()
        );

        assertThatCode(() -> ScriptRepositoryPublisher.assertToolVersionAvailable("repo-1", index, "demo-tool", "1.0.1"))
                .doesNotThrowAnyException();
        assertThatCode(() -> ScriptRepositoryPublisher.assertToolVersionAvailable("repo-1", index, "other-tool", "1.0.0"))
                .doesNotThrowAnyException();
    }

    @Test
    void rejectsPublishingSamePluginVersionInRepository() {
        RepositoryIndexFile index = new RepositoryIndexFile(
                1,
                "Demo Repository",
                null,
                List.of(),
                List.of(new RepositoryPluginIndexEntry(
                        "demo-plugin",
                        "Demo Plugin",
                        "1.0.0",
                        null,
                        null,
                        "plugins/demo-plugin/plugin.json"
                )),
                List.of()
        );

        assertThatThrownBy(() -> RepositoryCatalogTypes.assertPluginVersionAvailable(
                "repo-1",
                index,
                "demo-plugin",
                "1.0.0"
        ))
                .isInstanceOf(RepositoryVersionExistsException.class)
                .hasMessage("插件版本已存在: demo-plugin@1.0.0")
                .extracting("assetKind", "repositoryId", "assetId", "version")
                .containsExactly("PLUGIN", "repo-1", "demo-plugin", "1.0.0");
    }

    @Test
    void allowsPublishingDifferentPluginVersionOrDifferentPlugin() {
        RepositoryIndexFile index = new RepositoryIndexFile(
                1,
                "Demo Repository",
                null,
                List.of(),
                List.of(new RepositoryPluginIndexEntry(
                        "demo-plugin",
                        "Demo Plugin",
                        "1.0.0",
                        null,
                        null,
                        "plugins/demo-plugin/plugin.json"
                )),
                List.of()
        );

        assertThatCode(() -> RepositoryCatalogTypes.assertPluginVersionAvailable("repo-1", index, "demo-plugin", "1.0.1"))
                .doesNotThrowAnyException();
        assertThatCode(() -> RepositoryCatalogTypes.assertPluginVersionAvailable("repo-1", index, "other-plugin", "1.0.0"))
                .doesNotThrowAnyException();
    }

    @Test
    void localArtifactResolverReadsRepositoryRelativeJar() throws Exception {
        Path jar = tempDir.resolve("plugins/demo-plugin/demo-plugin-1.0.0.jar");
        Files.createDirectories(jar.getParent());
        Files.write(jar, new byte[]{1, 2, 3});

        PluginArtifact artifact = new LocalPluginArtifactResolver().resolve(
                new PluginArtifactRef("local://plugins/demo-plugin/demo-plugin-1.0.0.jar", "sha", null, null),
                new PluginArtifactContext(localRepository(), null, tempDir)
        );

        assertThat(artifact.fileName()).isEqualTo("demo-plugin-1.0.0.jar");
        assertThat(artifact.content()).containsExactly(1, 2, 3);
    }

    @Test
    void localArtifactResolverRejectsUnsafePaths() {
        LocalPluginArtifactResolver resolver = new LocalPluginArtifactResolver();
        PluginArtifactContext context = new PluginArtifactContext(localRepository(), null, tempDir);

        assertThatThrownBy(() -> resolver.resolve(new PluginArtifactRef("local:///tmp/demo.jar", "sha", null, null), context))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("绝对路径");
        assertThatThrownBy(() -> resolver.resolve(new PluginArtifactRef("local://plugins/../demo.jar", "sha", null, null), context))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("..");
        assertThatThrownBy(() -> resolver.resolve(new PluginArtifactRef("local://C:/demo.jar", "sha", null, null), context))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("绝对路径");
    }

    @Test
    void localArtifactResolverRejectsSymlinkEscapes() throws Exception {
        Path outside = Files.createTempFile("actiondock-outside", ".jar");
        Path link = tempDir.resolve("plugins/demo-plugin/outside.jar");
        Files.createDirectories(link.getParent());
        Files.createSymbolicLink(link, outside);

        assertThatThrownBy(() -> new LocalPluginArtifactResolver().resolve(
                new PluginArtifactRef("local://plugins/demo-plugin/outside.jar", "sha", null, null),
                new PluginArtifactContext(localRepository(), null, tempDir)
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("越界");
    }

    @Test
    void localArtifactResolverRejectsHttpRepository() {
        RepositoryDefinition repository = new RepositoryDefinition().setId("http-repo").setType("HTTP").setUrl("https://example.com/repo");

        assertThatThrownBy(() -> new LocalPluginArtifactResolver().resolve(
                new PluginArtifactRef("local://plugins/demo.jar", "sha", null, null),
                new PluginArtifactContext(repository, null, tempDir)
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("HTTP 仓库不支持");
    }

    @Test
    void httpArtifactResolverDownloadsBytesAndDerivesFileName() throws Exception {
        HttpServer server = startHttpServer(200, new byte[]{4, 5, 6});
        try {
            String uri = "http://127.0.0.1:" + server.getAddress().getPort() + "/artifacts/demo.jar";

            PluginArtifact artifact = new HttpPluginArtifactResolver().resolve(
                    new PluginArtifactRef(uri, "sha", null, null),
                    new PluginArtifactContext(localRepository(), null, tempDir)
            );

            assertThat(artifact.fileName()).isEqualTo("demo.jar");
            assertThat(artifact.content()).containsExactly(4, 5, 6);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void httpArtifactResolverRejectsFailedDownloads() throws Exception {
        HttpServer server = startHttpServer(404, new byte[]{});
        try {
            String uri = "http://127.0.0.1:" + server.getAddress().getPort() + "/missing.jar";

            assertThatThrownBy(() -> new HttpPluginArtifactResolver().resolve(
                    new PluginArtifactRef(uri, "sha", null, null),
                    new PluginArtifactContext(localRepository(), null, tempDir)
            ))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("HTTP 状态码: 404");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void resolveProjectRepositoryReturnsRawMarkdownContent() throws Exception {
        Path projectRoot = tempDir.resolve("billing-service");
        Files.createDirectories(projectRoot);
        Files.writeString(projectRoot.resolve("ACTIONDOCK.md"), "# Billing Service\n\nUse docs first.\n");
        RepositoryDefinition repository = new RepositoryDefinition()
                .setId("billing-service")
                .setName("Billing Service")
                .setType(REPO_TYPE_LOCAL_DIR)
                .setPurpose(REPO_PURPOSE_PROJECT)
                .setUrl(projectRoot.toString())
                .setEnabled(true);

        RepositoryCatalogService service = new RepositoryCatalogService(
                repositories(List.of(repository)),
                new RepositoryCatalogService.ApplicationServices(null, null, PluginRuntimeService.disabled()),
                jsonCodec,
                appProperties(),
                null
        );

        RepositoryCatalogService.ProjectRepositoryResolution resolution = service.resolveProjectRepository("billing-service");

        assertThat(resolution.repositoryId()).isEqualTo("billing-service");
        assertThat(resolution.entryPath()).isEqualTo("ACTIONDOCK.md");
        assertThat(resolution.content()).contains("Billing Service");
    }

    @Test
    void resolveProjectRepositoryDoesNotAutoSyncGitRepository() {
        Path missingGitRoot = tempDir.resolve("actiondock-home").resolve("repositories").resolve("billing-service");
        RepositoryDefinition repository = new RepositoryDefinition()
                .setId("billing-service")
                .setName("Billing Service")
                .setType(REPO_TYPE_GIT)
                .setPurpose(REPO_PURPOSE_PROJECT)
                .setUrl("https://example.com/billing.git")
                .setEnabled(true);

        RepositoryCatalogService service = new RepositoryCatalogService(
                repositories(List.of(repository)),
                new RepositoryCatalogService.ApplicationServices(null, null, PluginRuntimeService.disabled()),
                jsonCodec,
                appProperties(),
                null
        );

        assertThatThrownBy(() -> service.resolveProjectRepository("billing-service"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("项目仓库尚未同步，请先同步仓库")
                .hasMessageContaining("billing-service");
        assertThat(Files.exists(missingGitRoot)).isFalse();
    }

    @Test
    void projectLocalDirRepositoryDoesNotInitializeCapabilityWorkspaceOnSave() {
        Path projectRoot = tempDir.resolve("project-no-index");
        RepositoryDefinitionRepository repositoryDefinitionRepository = new InMemoryRepositoryDefinitionRepository();
        RepositoryDefinitionService service = new RepositoryDefinitionService(repositoryDefinitionRepository, jsonCodec, tempDir.resolve("repositories"));

        RepositoryDefinition saved = service.saveRepository(new RepositoryDefinition()
                .setId("project-no-index")
                .setName("Project No Index")
                .setType(REPO_TYPE_LOCAL_DIR)
                .setPurpose(REPO_PURPOSE_PROJECT)
                .setUrl(projectRoot.toString())
                .setEnabled(true));

        assertThat(saved.getPurpose()).isEqualTo(REPO_PURPOSE_PROJECT);
        assertThat(Files.exists(projectRoot.resolve("actiondock.repository.json"))).isFalse();
        assertThat(Files.exists(projectRoot.resolve("tools"))).isFalse();
    }

    private RepositoryDefinition localRepository() {
        return new RepositoryDefinition().setId("repo-1").setType("LOCAL_DIR").setUrl(tempDir.toString());
    }

    private HttpServer startHttpServer(int status, byte[] body) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            exchange.sendResponseHeaders(status, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        return server;
    }

    private RepositoryCatalogService.Repositories repositories(List<RepositoryDefinition> items) {
        return new RepositoryCatalogService.Repositories(
                new InMemoryRepositoryDefinitionRepository(items),
                mock(CapabilityPackageInstallationRepository.class),
                mock(ManagedSkillRepository.class),
                mock(ScriptRepository.class),
                mock(ScriptScheduleRepository.class),
                mock(ExecutionPresetRepository.class),
                mock(ConfigValueRepository.class),
                mock(org.team4u.actiondock.domain.port.WebhookRepository.class),
                new EmptyRepositoryLocalAssetRepository(),
                mock(org.team4u.actiondock.ai.api.AiModelProfileRepository.class),
                mock(org.team4u.actiondock.ai.api.AiAgentProfileRepository.class),
                mock(org.team4u.actiondock.ai.api.AiToolsetRepository.class)
        );
    }

    private AppProperties appProperties() {
        AppProperties properties = new AppProperties();
        properties.setHomeDir(tempDir.resolve("actiondock-home").toString());
        return properties;
    }

    private static final class InMemoryRepositoryDefinitionRepository implements RepositoryDefinitionRepository {
        private final java.util.LinkedHashMap<String, RepositoryDefinition> items = new java.util.LinkedHashMap<>();

        private InMemoryRepositoryDefinitionRepository() {
        }

        private InMemoryRepositoryDefinitionRepository(List<RepositoryDefinition> initialItems) {
            for (RepositoryDefinition item : initialItems) {
                save(item);
            }
        }

        @Override
        public RepositoryDefinition save(RepositoryDefinition registryDefinition) {
            items.put(registryDefinition.getId(), registryDefinition);
            return registryDefinition;
        }

        @Override
        public java.util.Optional<RepositoryDefinition> findById(String id) {
            return java.util.Optional.ofNullable(items.get(id));
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

    private static final class EmptyRepositoryLocalAssetRepository implements RepositoryLocalAssetRepository {
        @Override
        public RepositoryLocalAsset save(RepositoryLocalAsset asset) {
            return asset;
        }

        @Override
        public Optional<RepositoryLocalAsset> findById(String id) {
            return Optional.empty();
        }

        @Override
        public Optional<RepositoryLocalAsset> findByLocalAsset(UpstreamAssetType assetType, String localAssetId) {
            return Optional.empty();
        }

        @Override
        public Optional<RepositoryLocalAsset> findByUpstreamAsset(UpstreamAssetType assetType, String repositoryId, String upstreamAssetId) {
            return Optional.empty();
        }

        @Override
        public List<RepositoryLocalAsset> findAll() {
            return List.of();
        }

        @Override
        public void deleteById(String id) {
        }
    }

    private static final class TestJsonCodec implements JsonCodec {
        private final ObjectMapper objectMapper = new ObjectMapper();

        @Override
        public String write(Object value) {
            try {
                return value == null ? null : objectMapper.writeValueAsString(value);
            } catch (Exception e) {
                throw new IllegalStateException("Cannot serialize value", e);
            }
        }

        @Override
        public <T> T read(String json, Class<T> type) {
            try {
                return json == null || json.isBlank() ? null : objectMapper.readValue(json, type);
            } catch (Exception e) {
                throw new IllegalStateException("Cannot deserialize value", e);
            }
        }

        @Override
        public Object readUntyped(String json) {
            try {
                return json == null || json.isBlank() ? null : objectMapper.readValue(json, Object.class);
            } catch (Exception e) {
                throw new IllegalStateException("Cannot deserialize value", e);
            }
        }

        @Override
        public <T> List<T> readList(String json, Class<T> elementType) {
            try {
                if (json == null || json.isBlank()) {
                    return List.of();
                }
                return objectMapper.readValue(
                        json,
                        objectMapper.getTypeFactory().constructCollectionType(List.class, elementType)
                );
            } catch (Exception e) {
                throw new IllegalStateException("Cannot deserialize list", e);
            }
        }

        @Override
        @SuppressWarnings("unchecked")
        public Map<String, Object> readMap(String json) {
            try {
                return json == null || json.isBlank() ? Map.of() : objectMapper.readValue(json, Map.class);
            } catch (Exception e) {
                throw new IllegalStateException("Cannot deserialize map", e);
            }
        }
    }
}
