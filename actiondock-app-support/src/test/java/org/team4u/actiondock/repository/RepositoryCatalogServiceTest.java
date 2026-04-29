package org.team4u.actiondock.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.port.JsonCodec;

import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RepositoryCatalogServiceTest {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final JsonCodec jsonCodec = new TestJsonCodec();

    @TempDir
    Path tempDir;

    @Test
    void ensureRepositoryWorkspaceCreatesMissingIndexAndDirectories() throws Exception {
        Path root = tempDir.resolve("repo-root");
        RepositoryDefinition repository = new RepositoryDefinition()
                .setId("repo-1")
                .setName("Demo Repository")
                .setDescription("Demo description");

        RepositoryCatalogService.ensureRepositoryWorkspace(root, repository, jsonCodec);

        assertThat(Files.isDirectory(root.resolve("tools"))).isTrue();
        assertThat(Files.isDirectory(root.resolve("plugins"))).isTrue();
        assertThat(Files.isRegularFile(root.resolve("actiondock.repository.json"))).isTrue();

        RepositoryCatalogService.RepositoryIndexFile index = objectMapper.readValue(
                Files.readString(root.resolve("actiondock.repository.json")),
                RepositoryCatalogService.RepositoryIndexFile.class
        );
        assertThat(index.name()).isEqualTo("Demo Repository");
        assertThat(index.description()).isEqualTo("Demo description");
        assertThat(index.tools()).isEmpty();
        assertThat(index.plugins()).isEmpty();
    }

    @Test
    void ensureRepositoryWorkspaceFallsBackToRepositoryIdWhenNameMissing() throws Exception {
        Path root = tempDir.resolve("repo-without-name");
        RepositoryDefinition repository = new RepositoryDefinition()
                .setId("repo-2")
                .setDescription("Only description");

        RepositoryCatalogService.ensureRepositoryWorkspace(root, repository, jsonCodec);

        RepositoryCatalogService.RepositoryIndexFile index = objectMapper.readValue(
                Files.readString(root.resolve("actiondock.repository.json")),
                RepositoryCatalogService.RepositoryIndexFile.class
        );
        assertThat(index.name()).isEqualTo("repo-2");
        assertThat(index.description()).isEqualTo("Only description");
    }

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
        RepositoryCatalogService.ToolFile tool = new RepositoryCatalogService.ToolFile(
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
        RepositoryCatalogService.ToolFile restored = objectMapper.readValue(json, RepositoryCatalogService.ToolFile.class);

        assertThat(restored.scriptDependencies()).singleElement()
                .satisfies(item -> {
                    assertThat(item.getScriptId()).isEqualTo("child");
                    assertThat(item.getRepositoryId()).isEqualTo("repo-a");
                    assertThat(item.getToolId()).isEqualTo("child-tool");
                    assertThat(item.getVersionRange()).isEqualTo(">= 1.2.0");
                });
    }

    @Test
    void repositoryMetadataRejectsIndexEntriesWithoutReleaseNotes() {
        String indexJson = """
                {
                  "repositoryVersion": 1,
                  "name": "Demo Repository",
                  "tools": [
                    {
                      "id": "demo-tool",
                      "name": "Demo Tool",
                      "version": "1.0.0",
                      "type": "GROOVY",
                      "description": "Asset docs",
                      "toolPath": "tools/demo-tool/tool.json"
                    }
                  ],
                  "plugins": []
                }
                """;
        String toolJson = """
                {
                  "toolVersion": 1,
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

        assertThatThrownBy(() -> RepositoryCatalogService.assertLatestRepositoryMetadata(
                indexJson,
                RepositoryCatalogService.RepositoryIndexFile.class,
                "actiondock.repository.json"
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("tools[0].releaseNotes");
        assertThatThrownBy(() -> RepositoryCatalogService.assertLatestRepositoryMetadata(
                toolJson,
                RepositoryCatalogService.ToolFile.class,
                "tool.json"
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("tool.json releaseNotes");
        assertThatThrownBy(() -> RepositoryCatalogService.assertLatestRepositoryMetadata(
                pluginJson,
                RepositoryCatalogService.PluginFile.class,
                "plugin.json"
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("plugin.json releaseNotes");
    }

    @Test
    void repositoryMetadataAcceptsExplicitNullReleaseNotes() throws Exception {
        String indexJson = """
                {
                  "repositoryVersion": 1,
                  "name": "Demo Repository",
                  "tools": [
                    {
                      "id": "demo-tool",
                      "name": "Demo Tool",
                      "version": "1.0.0",
                      "type": "GROOVY",
                      "description": "Asset docs",
                      "releaseNotes": null,
                      "toolPath": "tools/demo-tool/tool.json"
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
                  "toolPath": "tools/demo-tool/tool.json"
                }
                """;
        String toolJson = """
                {
                  "toolVersion": 1,
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

        assertThatCode(() -> RepositoryCatalogService.assertLatestRepositoryMetadata(
                indexJson,
                RepositoryCatalogService.RepositoryIndexFile.class,
                "actiondock.repository.json"
        )).doesNotThrowAnyException();
        assertThatCode(() -> RepositoryCatalogService.assertLatestRepositoryMetadata(
                toolJson,
                RepositoryCatalogService.ToolFile.class,
                "tool.json"
        )).doesNotThrowAnyException();
        assertThatCode(() -> RepositoryCatalogService.assertLatestRepositoryMetadata(
                pluginJson,
                RepositoryCatalogService.PluginFile.class,
                "plugin.json"
        )).doesNotThrowAnyException();

        RepositoryCatalogService.RepositoryIndexEntry entry = objectMapper.readValue(
                indexEntryJson,
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
                List.of(),
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
                List.of(),
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
                )),
                List.of()
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
                )),
                List.of()
        );

        assertThatCode(() -> RepositoryCatalogService.assertPluginVersionAvailable("repo-1", index, "demo-plugin", "1.0.1"))
                .doesNotThrowAnyException();
        assertThatCode(() -> RepositoryCatalogService.assertPluginVersionAvailable("repo-1", index, "other-plugin", "1.0.0"))
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
