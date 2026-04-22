package org.team4u.scriptflow.plugin;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.pf4j.Plugin;
import org.pf4j.PluginWrapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.team4u.scriptflow.config.AppProperties;
import org.team4u.scriptflow.domain.model.PluginRegistration;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptExecutionContext;
import org.team4u.scriptflow.domain.model.SubmitMode;
import org.team4u.scriptflow.domain.port.JsonCodec;
import org.team4u.scriptflow.domain.port.PluginRegistryRepository;
import org.team4u.scriptflow.plugin.api.ScriptFlowPlugin;
import org.team4u.scriptflow.plugin.api.ScriptPluginContext;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.jar.Attributes;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import java.util.jar.Manifest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PluginRuntimeServiceTest {
    @TempDir
    Path tempDir;

    private final JsonCodec jsonCodec = new TestJsonCodec();

    @Test
    void supportsInstallConfigInvokeStopAndUninstall() throws IOException {
        Path pluginJar = buildPluginJar(
                Files.createTempFile("scriptflow-plugin-upload-", ".jar"),
                demoPluginManifestJson("0.2.0", "ScriptFlow Demo Plugin")
        );
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        InMemoryPluginRegistryRepository repository = new InMemoryPluginRegistryRepository();
        PluginRuntimeService service = new PluginRuntimeService(jsonCodec, repository, properties);

        PluginView installed = service.install("demo-plugin.jar", Files.readAllBytes(pluginJar));

        assertThat(installed.getPluginId()).isEqualTo("scriptflow-demo-plugin");
        assertThat(installed.isStarted()).isTrue();
        assertThat(installed.getActions()).singleElement().satisfies(action -> {
            assertThat(action.getInputSchema()).containsEntry("type", "object");
            assertThat(action.getOutputSchema()).containsEntry("type", "object");
        });
        assertThat(repository.findByPluginId("scriptflow-demo-plugin").orElseThrow().isEnabled()).isTrue();
        assertThat(service.getConfig("scriptflow-demo-plugin").getConfig()).containsEntry("prefix", "demo");
        assertThat(service.get("scriptflow-demo-plugin").getPluginId()).isEqualTo("scriptflow-demo-plugin");

        service.saveConfig("scriptflow-demo-plugin", Map.of("prefix", "hello"));
        Object value = service.invoke(
                "scriptflow-demo-plugin",
                "echo",
                new ScriptDefinition().setId("script-1").setName("Hello"),
                new ScriptExecutionContext().setExecutionId("exec-1").setSubmitMode(SubmitMode.SYNC),
                Map.of("name", "Alice"),
                Map.of("message", "world")
        );

        assertThat(value).isEqualTo(Map.of(
                "message", "hello:world",
                "scriptId", "script-1",
                "executionId", "exec-1"
        ));

        PluginInvokeView debugInvoke = service.invokeForDebug(
                "scriptflow-demo-plugin",
                "echo",
                Map.of("message", "debug"),
                Map.of("name", "Alice"),
                true
        );

        assertThat(debugInvoke.getResult()).containsEntry("message", "hello:debug");
        assertThat(debugInvoke.getDebug()).isNotNull();
        assertThat(debugInvoke.getDebug().getArgs()).containsEntry("message", "debug");
        assertThat(debugInvoke.getDebug().getScriptInput()).containsEntry("name", "Alice");

        PluginView stopped = service.stop("scriptflow-demo-plugin");
        assertThat(stopped.isStarted()).isFalse();
        assertThat(repository.findByPluginId("scriptflow-demo-plugin").orElseThrow().isEnabled()).isFalse();
        assertThatThrownBy(() -> service.assertActionAvailable("scriptflow-demo-plugin", "echo"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("未启动");

        PluginView restarted = service.start("scriptflow-demo-plugin");
        assertThat(restarted.isStarted()).isTrue();
        service.uninstall("scriptflow-demo-plugin");

        assertThat(service.list()).isEmpty();
        assertThat(repository.findAll()).isEmpty();
        assertThat(Files.exists(tempDir.resolve(".scriptflow-config").resolve("scriptflow-demo-plugin.json"))).isFalse();
    }

    @Test
    void initializesOnlyEnabledPluginsFromRegistry() throws IOException {
        Path pluginJar = buildPluginJar(tempDir.resolve("enabled-plugin.jar"), demoPluginManifestJson("0.2.0", "ScriptFlow Demo Plugin"));
        InMemoryPluginRegistryRepository repository = new InMemoryPluginRegistryRepository();
        repository.save(new PluginRegistration()
                .setPluginId("scriptflow-demo-plugin")
                .setName("ScriptFlow Demo Plugin")
                .setVersion("0.2.0")
                .setDescription("Demo")
                .setFileName(pluginJar.getFileName().toString())
                .setEnabled(true));
        repository.save(new PluginRegistration()
                .setPluginId("disabled-plugin")
                .setName("Disabled")
                .setFileName("disabled.jar")
                .setEnabled(false));

        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        PluginRuntimeService service = new PluginRuntimeService(jsonCodec, repository, properties);

        assertThat(service.list()).hasSize(2);
        assertThat(service.list().stream()
                .filter(item -> "scriptflow-demo-plugin".equals(item.getPluginId()))
                .findFirst()
                .orElseThrow()
                .isStarted()).isTrue();
        assertThat(service.list().stream()
                .filter(item -> "disabled-plugin".equals(item.getPluginId()))
                .findFirst()
                .orElseThrow()
                .isStarted()).isFalse();
    }

    @Test
    void upgradeReloadsEnabledPluginAndPreservesConfig() throws IOException {
        Path pluginJar = buildPluginJar(tempDir.resolve("demo-plugin.jar"), demoPluginManifestJson("0.2.0", "ScriptFlow Demo Plugin"));
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        InMemoryPluginRegistryRepository repository = new InMemoryPluginRegistryRepository();
        PluginRuntimeService service = new PluginRuntimeService(jsonCodec, repository, properties);

        service.install("demo-plugin.jar", Files.readAllBytes(pluginJar));
        service.saveConfig("scriptflow-demo-plugin", Map.of("prefix", "hello"));
        String oldFileName = repository.findByPluginId("scriptflow-demo-plugin").orElseThrow().getFileName();

        Path upgradedJar = buildPluginJar(
                tempDir.resolve("demo-plugin-upgraded.jar"),
                demoPluginManifestJson("0.3.0", "ScriptFlow Demo Plugin Upgraded")
        );

        PluginView upgraded = service.upgrade("scriptflow-demo-plugin", "demo-plugin-upgraded.jar", Files.readAllBytes(upgradedJar));

        assertThat(upgraded.isStarted()).isTrue();
        assertThat(upgraded.getVersion()).isEqualTo("0.3.0");
        assertThat(upgraded.getName()).isEqualTo("ScriptFlow Demo Plugin Upgraded");
        assertThat(repository.findByPluginId("scriptflow-demo-plugin").orElseThrow().getFileName())
                .startsWith("demo-plugin-upgraded")
                .endsWith(".jar");
        assertThat(service.getConfig("scriptflow-demo-plugin").getConfig()).containsEntry("prefix", "hello");
        assertThat(Files.exists(tempDir.resolve(oldFileName))).isFalse();
    }

    @Test
    void upgradeKeepsDisabledPluginStopped() throws IOException {
        Path pluginJar = buildPluginJar(tempDir.resolve("demo-plugin.jar"), demoPluginManifestJson("0.2.0", "ScriptFlow Demo Plugin"));
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        InMemoryPluginRegistryRepository repository = new InMemoryPluginRegistryRepository();
        PluginRuntimeService service = new PluginRuntimeService(jsonCodec, repository, properties);

        service.install("demo-plugin.jar", Files.readAllBytes(pluginJar));
        service.stop("scriptflow-demo-plugin");

        Path upgradedJar = buildPluginJar(
                tempDir.resolve("demo-plugin-upgraded.jar"),
                demoPluginManifestJson("0.3.1", "ScriptFlow Demo Plugin Disabled")
        );

        PluginView upgraded = service.upgrade("scriptflow-demo-plugin", "demo-plugin-upgraded.jar", Files.readAllBytes(upgradedJar));

        assertThat(upgraded.isStarted()).isFalse();
        assertThat(upgraded.getState()).isEqualTo("DISABLED");
        assertThat(repository.findByPluginId("scriptflow-demo-plugin").orElseThrow().isEnabled()).isFalse();
    }

    @Test
    void saveConfigValidatesAndReturnsEffectiveConfig() throws IOException {
        Path pluginJar = buildPluginJar(
                tempDir.resolve("effective-config-plugin.jar"),
                effectiveConfigManifestJson(),
                EffectiveConfigValidationBootstrap.class,
                EffectiveConfigValidationPlugin.class
        );
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        InMemoryPluginRegistryRepository repository = new InMemoryPluginRegistryRepository();
        PluginRuntimeService service = new PluginRuntimeService(jsonCodec, repository, properties);

        service.install("effective-config-plugin.jar", Files.readAllBytes(pluginJar));

        PluginConfigView saved = service.saveConfig("effective-config-plugin", Map.of());

        assertThat(saved.getConfig()).containsEntry("prefix", "demo");
        assertThat(service.getConfig("effective-config-plugin").getConfig()).containsEntry("prefix", "demo");
        assertThat(Files.readString(tempDir.resolve(".scriptflow-config").resolve("effective-config-plugin.json")))
                .isEqualTo("{}");
    }

    private Path buildPluginJar(Path destination, String manifestJson) throws IOException {
        return buildPluginJar(
                destination,
                manifestJson,
                org.team4u.scriptflow.plugin.template.TemplatePlugin.class,
                org.team4u.scriptflow.plugin.template.DemoScriptFlowPlugin.class,
                org.team4u.scriptflow.plugin.template.DemoPluginConfig.class
        );
    }

    private Path buildPluginJar(Path destination,
                                String manifestJson,
                                Class<?> pluginClass,
                                Class<?> extensionClass,
                                Class<?>... additionalClasses) throws IOException {
        Manifest manifest = new Manifest();
        Attributes attributes = manifest.getMainAttributes();
        attributes.put(Attributes.Name.MANIFEST_VERSION, "1.0");
        attributes.putValue("Plugin-Id", pluginIdFromManifest(manifestJson));
        attributes.putValue("Plugin-Class", pluginClass.getName());
        attributes.putValue("Plugin-Version", "0.2.0");
        attributes.putValue("Plugin-Provider", "team4u");

        try (JarOutputStream outputStream = new JarOutputStream(Files.newOutputStream(destination), manifest)) {
            addClass(outputStream, pluginClass);
            addClass(outputStream, extensionClass);
            for (Class<?> additionalClass : additionalClasses) {
                addClass(outputStream, additionalClass);
            }
            String pluginId = pluginIdFromManifest(manifestJson);
            addResource(outputStream, "META-INF/scriptflow/plugins/" + pluginId + ".json", manifestJson);
            outputStream.putNextEntry(new JarEntry("META-INF/extensions.idx"));
            outputStream.write((extensionClass.getName() + "\n").getBytes());
            outputStream.closeEntry();
        }
        return destination;
    }

    private String pluginIdFromManifest(String manifestJson) {
        return jsonCodec.read(manifestJson, Map.class).get("pluginId").toString();
    }

    private void addClass(JarOutputStream outputStream, Class<?> type) throws IOException {
        String entryName = type.getName().replace('.', '/') + ".class";
        outputStream.putNextEntry(new JarEntry(entryName));
        try (InputStream inputStream = type.getClassLoader().getResourceAsStream(entryName)) {
            if (inputStream == null) {
                throw new IllegalStateException("Missing class bytes for " + type.getName());
            }
            outputStream.write(inputStream.readAllBytes());
        }
        outputStream.closeEntry();
    }

    private void addResource(JarOutputStream outputStream, String entryName, String content) throws IOException {
        outputStream.putNextEntry(new JarEntry(entryName));
        outputStream.write(content.getBytes());
        outputStream.closeEntry();
    }

    private String demoPluginManifestJson(String version, String name) {
        return """
                {
                  "pluginId": "scriptflow-demo-plugin",
                  "name": "%s",
                  "description": "Template plugin exposing sample actions to Groovy scripts.",
                  "version": "%s",
                  "configSchema": {
                    "type": "object",
                    "properties": {
                      "prefix": {
                        "type": "string",
                        "title": "Prefix"
                      }
                    }
                  },
                  "defaultConfig": {
                    "prefix": "demo"
                  },
                  "actions": [
                    {
                      "action": "echo",
                      "title": "Echo message",
                      "description": "Return a message prefixed by plugin configuration.",
                      "inputSchema": {
                        "type": "object",
                        "properties": {
                          "message": {
                            "type": "string",
                            "title": "Message"
                          }
                        }
                      },
                      "outputSchema": {
                        "type": "object",
                        "properties": {
                          "message": {
                            "type": "string",
                            "title": "Message"
                          },
                          "scriptId": {
                            "type": "string",
                            "title": "Script ID"
                          },
                          "executionId": {
                            "type": "string",
                            "title": "Execution ID"
                          }
                        }
                      },
                      "exampleArgs": {
                        "message": "hello"
                      }
                    }
                  ]
                }
                """.formatted(name, version);
    }

    private String effectiveConfigManifestJson() {
        return """
                {
                  "pluginId": "effective-config-plugin",
                  "name": "Effective Config Plugin",
                  "description": "Validates effective config values.",
                  "version": "0.2.0",
                  "configSchema": {
                    "type": "object",
                    "properties": {
                      "prefix": {
                        "type": "string",
                        "title": "Prefix"
                      }
                    }
                  },
                  "defaultConfig": {
                    "prefix": "demo"
                  },
                  "actions": [
                    {
                      "action": "echo",
                      "title": "Echo message",
                      "description": "Return a message prefixed by plugin configuration.",
                      "inputSchema": {
                        "type": "object"
                      },
                      "outputSchema": {
                        "type": "object"
                      }
                    }
                  ]
                }
                """;
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

    private static final class InMemoryPluginRegistryRepository implements PluginRegistryRepository {
        private final Map<String, PluginRegistration> values = new ConcurrentHashMap<>();

        @Override
        public PluginRegistration save(PluginRegistration registration) {
            PluginRegistration copy = copy(registration);
            values.put(copy.getPluginId(), copy);
            return copy(copy);
        }

        @Override
        public Optional<PluginRegistration> findByPluginId(String pluginId) {
            PluginRegistration registration = values.get(pluginId);
            return registration == null ? Optional.empty() : Optional.of(copy(registration));
        }

        @Override
        public List<PluginRegistration> findAll() {
            return values.values().stream().map(this::copy).toList();
        }

        @Override
        public List<PluginRegistration> findEnabled() {
            List<PluginRegistration> enabled = new ArrayList<>();
            values.values().forEach(registration -> {
                if (registration.isEnabled()) {
                    enabled.add(copy(registration));
                }
            });
            return enabled;
        }

        @Override
        public void deleteByPluginId(String pluginId) {
            values.remove(pluginId);
        }

        private PluginRegistration copy(PluginRegistration registration) {
            return new PluginRegistration()
                    .setPluginId(registration.getPluginId())
                    .setName(registration.getName())
                    .setDescription(registration.getDescription())
                    .setVersion(registration.getVersion())
                    .setFileName(registration.getFileName())
                    .setConfigSchema(registration.getConfigSchema())
                    .setDefaultConfig(registration.getDefaultConfig())
                    .setActions(registration.getActions())
                    .setEnabled(registration.isEnabled())
                    .setInstalledAt(registration.getInstalledAt())
                    .setUpdatedAt(registration.getUpdatedAt());
        }
    }

    public static final class EffectiveConfigValidationBootstrap extends Plugin {
        public EffectiveConfigValidationBootstrap(PluginWrapper wrapper) {
            super(wrapper);
        }
    }

    public static final class EffectiveConfigValidationPlugin implements ScriptFlowPlugin {
        @Override
        public String id() {
            return "effective-config-plugin";
        }

        @Override
        public void validateConfig(Map<String, Object> config) {
            if (!"demo".equals(config.get("prefix"))) {
                throw new IllegalArgumentException("expected merged default config");
            }
        }

        @Override
        public Object invoke(String action, ScriptPluginContext context, Map<String, Object> args) {
            return Map.of("prefix", context.getPluginConfig().get("prefix"));
        }
    }
}
