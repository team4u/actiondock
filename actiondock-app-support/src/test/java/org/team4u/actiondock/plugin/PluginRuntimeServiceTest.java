package org.team4u.actiondock.plugin;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.pf4j.Plugin;
import org.pf4j.PluginWrapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.team4u.actiondock.ai.api.AiAgentResumeCommand;
import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentRunResult;
import org.team4u.actiondock.ai.api.AiAgentRunSnapshot;
import org.team4u.actiondock.ai.api.AiAgentRunSubmission;
import org.team4u.actiondock.ai.api.AiCallContext;
import org.team4u.actiondock.ai.api.AiChatRequest;
import org.team4u.actiondock.ai.api.AiChatResponse;
import org.team4u.actiondock.ai.api.AiEmbeddingRequest;
import org.team4u.actiondock.ai.api.AiEmbeddingResponse;
import org.team4u.actiondock.ai.api.AiGateway;
import org.team4u.actiondock.ai.api.AiStructuredRequest;
import org.team4u.actiondock.ai.api.AiStructuredResponse;
import org.team4u.actiondock.ai.plugin.ActionDockAiSystemPlugin;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;
import org.team4u.actiondock.workspace.plugin.ActionDockWorkspaceSystemPlugin;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
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
                Files.createTempFile("actiondock-plugin-upload-", ".jar"),
                demoPluginManifestJson("0.2.0", "ActionDock Demo Plugin")
        );
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        InMemoryPluginRegistryRepository repository = new InMemoryPluginRegistryRepository();
        PluginRuntimeService service = new PluginRuntimeService(jsonCodec, repository, properties);

        PluginView installed = service.install("demo-plugin.jar", Files.readAllBytes(pluginJar));

        assertThat(installed.getPluginId()).isEqualTo("actiondock-demo-plugin");
        assertThat(installed.isStarted()).isTrue();
        assertThat(installed.getActions()).singleElement().satisfies(action -> {
            assertThat(action.getInputSchema()).containsEntry("type", "object");
            assertThat(action.getOutputSchema()).containsEntry("type", "object");
        });
        assertThat(repository.findByPluginId("actiondock-demo-plugin").orElseThrow().isEnabled()).isTrue();
        assertThat(service.getConfig("actiondock-demo-plugin").getConfig()).containsEntry("prefix", "demo");
        assertThat(service.get("actiondock-demo-plugin").getPluginId()).isEqualTo("actiondock-demo-plugin");

        service.saveConfig("actiondock-demo-plugin", Map.of("prefix", "hello"));
        Object value = service.invoke(
                "actiondock-demo-plugin",
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
                "actiondock-demo-plugin",
                "echo",
                Map.of("message", "debug"),
                Map.of("name", "Alice"),
                true
        );

        assertThat(debugInvoke.getResult()).containsEntry("message", "hello:debug");
        assertThat(debugInvoke.getDebug()).isNotNull();
        assertThat(debugInvoke.getDebug().getArgs()).containsEntry("message", "debug");
        assertThat(debugInvoke.getDebug().getScriptInput()).containsEntry("name", "Alice");

        PluginView stopped = service.stop("actiondock-demo-plugin");
        assertThat(stopped.isStarted()).isFalse();
        assertThat(repository.findByPluginId("actiondock-demo-plugin").orElseThrow().isEnabled()).isFalse();

        PluginView restarted = service.start("actiondock-demo-plugin");
        assertThat(restarted.isStarted()).isTrue();
        Path installedPluginPath = tempDir.resolve(repository.findByPluginId("actiondock-demo-plugin").orElseThrow().getFileName());
        service.uninstall("actiondock-demo-plugin", true);

        assertThat(service.list()).isEmpty();
        assertThat(repository.findAll()).isEmpty();
        assertThat(Files.exists(installedPluginPath)).isFalse();
        assertThat(Files.exists(tempDir.resolve(".actiondock-config").resolve("actiondock-demo-plugin.json"))).isFalse();
    }

    @Test
    void installLoadsPluginFromFinalPathAfterStagingValidation() throws IOException {
        Path pluginJar = buildPluginJar(
                Files.createTempFile("actiondock-plugin-upload-", ".jar"),
                demoPluginManifestJson("0.2.0", "ActionDock Demo Plugin")
        );
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        InMemoryPluginRegistryRepository repository = new InMemoryPluginRegistryRepository();
        PluginRuntimeService service = new PluginRuntimeService(jsonCodec, repository, properties);

        service.install("demo-plugin.jar", Files.readAllBytes(pluginJar));

        PluginRegistration registration = repository.findByPluginId("actiondock-demo-plugin").orElseThrow();
        assertThat(service.getPluginPath("actiondock-demo-plugin"))
                .isEqualTo(tempDir.resolve(registration.getFileName()));
        assertThat(service.getPluginPath("actiondock-demo-plugin").toString()).doesNotContain(".staging");
        assertThat(service.invoke(
                "actiondock-demo-plugin",
                "echo",
                null,
                null,
                null,
                Map.of("message", "hello")
        )).isEqualTo(Map.of("message", "demo:hello"));
    }

    @Test
    void upgradeWithSameUploadFilenameLoadsPluginFromNewFinalPath() throws IOException {
        Path pluginJar = buildPluginJar(
                Files.createTempFile("actiondock-plugin-upload-", ".jar"),
                demoPluginManifestJson("0.2.0", "ActionDock Demo Plugin")
        );
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        InMemoryPluginRegistryRepository repository = new InMemoryPluginRegistryRepository();
        PluginRuntimeService service = new PluginRuntimeService(jsonCodec, repository, properties);
        service.install("demo-plugin.jar", Files.readAllBytes(pluginJar));
        String oldFileName = repository.findByPluginId("actiondock-demo-plugin").orElseThrow().getFileName();

        Path upgradedJar = buildPluginJar(
                Files.createTempFile("actiondock-plugin-upgrade-", ".jar"),
                demoPluginManifestJson("0.3.0", "ActionDock Demo Plugin Upgraded")
        );

        PluginView upgraded = service.upgrade("actiondock-demo-plugin", "demo-plugin.jar", Files.readAllBytes(upgradedJar));

        PluginRegistration registration = repository.findByPluginId("actiondock-demo-plugin").orElseThrow();
        assertThat(upgraded.getVersion()).isEqualTo("0.3.0");
        assertThat(registration.getFileName()).isNotEqualTo(oldFileName);
        assertThat(registration.getFileName()).startsWith("demo-plugin-").endsWith(".jar");
        assertThat(service.getPluginPath("actiondock-demo-plugin"))
                .isEqualTo(tempDir.resolve(registration.getFileName()));
        assertThat(service.getPluginPath("actiondock-demo-plugin").toString()).doesNotContain(".staging");
        assertThat(Files.exists(tempDir.resolve(oldFileName))).isFalse();
    }

    @Test
    void initializesOnlyEnabledPluginsFromRegistry() throws IOException {
        Path pluginJar = buildPluginJar(tempDir.resolve("enabled-plugin.jar"), demoPluginManifestJson("0.2.0", "ActionDock Demo Plugin"));
        InMemoryPluginRegistryRepository repository = new InMemoryPluginRegistryRepository();
        repository.save(new PluginRegistration()
                .setPluginId("actiondock-demo-plugin")
                .setName("ActionDock Demo Plugin")
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
                .filter(item -> "actiondock-demo-plugin".equals(item.getPluginId()))
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
        Path pluginJar = buildPluginJar(tempDir.resolve("demo-plugin.jar"), demoPluginManifestJson("0.2.0", "ActionDock Demo Plugin"));
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        InMemoryPluginRegistryRepository repository = new InMemoryPluginRegistryRepository();
        PluginRuntimeService service = new PluginRuntimeService(jsonCodec, repository, properties);

        service.install("demo-plugin.jar", Files.readAllBytes(pluginJar));
        service.saveConfig("actiondock-demo-plugin", Map.of("prefix", "hello"));
        String oldFileName = repository.findByPluginId("actiondock-demo-plugin").orElseThrow().getFileName();

        Path upgradedJar = buildPluginJar(
                tempDir.resolve("demo-plugin-upgraded.jar"),
                demoPluginManifestJson("0.3.0", "ActionDock Demo Plugin Upgraded")
        );

        PluginView upgraded = service.upgrade("actiondock-demo-plugin", "demo-plugin-upgraded.jar", Files.readAllBytes(upgradedJar));

        assertThat(upgraded.isStarted()).isTrue();
        assertThat(upgraded.getVersion()).isEqualTo("0.3.0");
        assertThat(upgraded.getName()).isEqualTo("ActionDock Demo Plugin Upgraded");
        assertThat(repository.findByPluginId("actiondock-demo-plugin").orElseThrow().getFileName())
                .startsWith("demo-plugin-upgraded")
                .endsWith(".jar");
        assertThat(service.getConfig("actiondock-demo-plugin").getConfig()).containsEntry("prefix", "hello");
        assertThat(Files.exists(tempDir.resolve(oldFileName))).isFalse();
    }

    @Test
    void upgradeKeepsDisabledPluginStopped() throws IOException {
        Path pluginJar = buildPluginJar(tempDir.resolve("demo-plugin.jar"), demoPluginManifestJson("0.2.0", "ActionDock Demo Plugin"));
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        InMemoryPluginRegistryRepository repository = new InMemoryPluginRegistryRepository();
        PluginRuntimeService service = new PluginRuntimeService(jsonCodec, repository, properties);

        service.install("demo-plugin.jar", Files.readAllBytes(pluginJar));
        service.stop("actiondock-demo-plugin");

        Path upgradedJar = buildPluginJar(
                tempDir.resolve("demo-plugin-upgraded.jar"),
                demoPluginManifestJson("0.3.1", "ActionDock Demo Plugin Disabled")
        );

        PluginView upgraded = service.upgrade("actiondock-demo-plugin", "demo-plugin-upgraded.jar", Files.readAllBytes(upgradedJar));

        assertThat(upgraded.isStarted()).isFalse();
        assertThat(upgraded.getState()).isEqualTo("DISABLED");
        assertThat(repository.findByPluginId("actiondock-demo-plugin").orElseThrow().isEnabled()).isFalse();
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
        assertThat(Files.readString(tempDir.resolve(".actiondock-config").resolve("effective-config-plugin.json")))
                .isEqualTo("{}");
    }

    @Test
    void invokeTypedConfigUsesEffectiveConfigFromManifestDefaults() throws IOException {
        Path pluginJar = buildPluginJar(
                tempDir.resolve("demo-plugin.jar"),
                demoPluginManifestJson("0.2.0", "ActionDock Demo Plugin")
        );
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        InMemoryPluginRegistryRepository repository = new InMemoryPluginRegistryRepository();
        PluginRuntimeService service = new PluginRuntimeService(jsonCodec, repository, properties);

        service.install("demo-plugin.jar", Files.readAllBytes(pluginJar));

        Map<String, Object> result = (Map<String, Object>) service.invoke(
                "actiondock-demo-plugin",
                "echo",
                null,
                null,
                null,
                Map.of("message", "hello")
        );

        assertThat(result).containsEntry("message", "demo:hello");
    }

    @Test
    void resolvesConfigPlaceholdersForPluginConfigAndDebugInputs() throws IOException {
        Path pluginJar = buildPluginJar(
                tempDir.resolve("demo-plugin.jar"),
                demoPluginManifestJson("0.2.0", "ActionDock Demo Plugin")
        );
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        InMemoryPluginRegistryRepository repository = new InMemoryPluginRegistryRepository();
        InMemoryConfigValueRepository configRepository = new InMemoryConfigValueRepository();
        ConfigValueApplicationService configService = new ConfigValueApplicationService(configRepository);
        configService.create(new ConfigValue().setKey("plugin_prefix").setValue("hello"));
        configService.create(new ConfigValue().setKey("message").setValue("debug"));
        configService.create(new ConfigValue().setKey("user_name").setValue("Alice"));
        PluginRuntimeService service = new PluginRuntimeService(jsonCodec, repository, properties, configService);

        service.install("demo-plugin.jar", Files.readAllBytes(pluginJar));
        service.saveConfig("actiondock-demo-plugin", Map.of("prefix", "${config.plugin_prefix}"));

        assertThat(service.getConfig("actiondock-demo-plugin").getConfig())
                .containsEntry("prefix", "${config.plugin_prefix}");

        Map<String, Object> result = (Map<String, Object>) service.invoke(
                "actiondock-demo-plugin",
                "echo",
                null,
                new ScriptExecutionContext().setSubmitMode(SubmitMode.SYNC).setConfig(configService.snapshot()),
                Map.of("name", "Alice"),
                Map.of("message", "world")
        );

        assertThat(result).containsEntry("message", "hello:world");

        PluginInvokeView debug = service.invokeForDebug(
                "actiondock-demo-plugin",
                "echo",
                Map.of("message", "${config.message}"),
                Map.of("name", "${config.user_name}"),
                true
        );

        assertThat(debug.getResult()).containsEntry("message", "hello:debug");
        assertThat(debug.getDebug().getArgs()).containsEntry("message", "debug");
        assertThat(debug.getDebug().getScriptInput()).containsEntry("name", "Alice");
    }

    @Test
    void listPluginReferencesIncludesStartedPluginsAndDocumentedSystemPlugins() throws IOException {
        Path pluginJar = buildPluginJar(
                Files.createTempFile("actiondock-plugin-upload-", ".jar"),
                demoPluginManifestJson("0.2.0", "ActionDock Demo Plugin")
        );
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        InMemoryPluginRegistryRepository repository = new InMemoryPluginRegistryRepository();
        PluginRuntimeService service = new PluginRuntimeService(
                jsonCodec,
                repository,
                properties,
                ConfigValueApplicationService.disabled(),
                List.of(documentedAiSystemPlugin())
        );

        service.install("demo-plugin.jar", Files.readAllBytes(pluginJar));

        List<PluginReferenceView> references = service.listPluginReferences();

        assertThat(references).extracting(PluginReferenceView::getPluginId)
                .containsExactly("actiondock-ai", "actiondock-demo-plugin");
        assertThat(references).filteredOn(reference -> "actiondock-ai".equals(reference.getPluginId()))
                .singleElement()
                .satisfies(reference -> {
                    assertThat(reference.getSourceType()).isEqualTo(PluginReferenceSourceType.SYSTEM);
                    assertThat(reference.isStarted()).isTrue();
                    assertThat(reference.getActions()).extracting(PluginActionView::getAction)
                            .containsExactly("chat", "structured", "embed", "agentRun");
                });
        assertThat(references).filteredOn(reference -> "actiondock-demo-plugin".equals(reference.getPluginId()))
                .singleElement()
                .satisfies(reference -> assertThat(reference.getSourceType()).isEqualTo(PluginReferenceSourceType.INSTALLED));

        assertThat(service.list()).filteredOn(plugin -> "actiondock-ai".equals(plugin.getPluginId()))
                .singleElement()
                .satisfies(plugin -> {
                    assertThat(plugin.getSourceType()).isEqualTo(PluginReferenceSourceType.SYSTEM);
                    assertThat(plugin.isStarted()).isTrue();
                    assertThat(plugin.getState()).isEqualTo("STARTED");
                });
    }

    @Test
    void listPluginReferencesIncludesDocumentedWorkspaceSystemPlugin() {
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        InMemoryPluginRegistryRepository repository = new InMemoryPluginRegistryRepository();
        PluginRuntimeService service = new PluginRuntimeService(
                jsonCodec,
                repository,
                properties,
                ConfigValueApplicationService.disabled(),
                List.of(new ActionDockWorkspaceSystemPlugin(tempDir.toString()))
        );

        List<PluginReferenceView> references = service.listPluginReferences();

        assertThat(references).extracting(PluginReferenceView::getPluginId)
                .containsExactly("actiondock-workspace");
        assertThat(references.getFirst().getActions()).extracting(PluginActionView::getAction)
                .containsExactly("listDirectory", "viewTextFile", "writeTextFile", "insertTextFile", "getSystemInfo", "executeShellCommand");
    }

    @Test
    void invokeCallsWorkspaceSystemPlugin() throws IOException {
        Files.writeString(tempDir.resolve("README.md"), "hello", StandardCharsets.UTF_8);
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        PluginRuntimeService service = new PluginRuntimeService(
                jsonCodec,
                new InMemoryPluginRegistryRepository(),
                properties,
                ConfigValueApplicationService.disabled(),
                List.of(new ActionDockWorkspaceSystemPlugin(tempDir.toString()))
        );

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) service.invoke(
                "actiondock-workspace",
                "viewTextFile",
                null,
                null,
                null,
                Map.of("path", "README.md")
        );

        assertThat(result).containsEntry("ok", true);
        assertThat(result).containsEntry("filePath", tempDir.resolve("README.md").toString());
        assertThat(result.get("content")).isEqualTo("1: hello\n");
    }

    @Test
    void systemPluginStopDisablesReferencesAndInvocationUntilRestarted() {
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        InMemorySystemPluginStateRepository stateRepository = new InMemorySystemPluginStateRepository();
        PluginRuntimeService service = new PluginRuntimeService(
                jsonCodec,
                new InMemoryPluginRegistryRepository(),
                stateRepository,
                null,
                properties,
                ConfigValueApplicationService.disabled(),
                List.of(new ActionDockWorkspaceSystemPlugin(tempDir.toString()))
        );

        PluginView stopped = service.stop("actiondock-workspace");

        assertThat(stopped.isStarted()).isFalse();
        assertThat(stopped.getState()).isEqualTo("DISABLED");
        assertThat(service.listPluginReferences()).isEmpty();
        assertThatThrownBy(() -> service.invoke(
                "actiondock-workspace",
                "listDirectory",
                null,
                null,
                null,
                Map.of("path", ".")
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("插件未启动: actiondock-workspace");

        PluginRuntimeService restartedRuntime = new PluginRuntimeService(
                jsonCodec,
                new InMemoryPluginRegistryRepository(),
                stateRepository,
                null,
                properties,
                ConfigValueApplicationService.disabled(),
                List.of(new ActionDockWorkspaceSystemPlugin(tempDir.toString()))
        );
        assertThat(restartedRuntime.get("actiondock-workspace").isStarted()).isFalse();

        PluginView started = restartedRuntime.start("actiondock-workspace");

        assertThat(started.isStarted()).isTrue();
        assertThat(restartedRuntime.listPluginReferences()).hasSize(1);
    }

    @Test
    void systemPluginsRejectArtifactOperations() {
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        PluginRuntimeService service = new PluginRuntimeService(
                jsonCodec,
                new InMemoryPluginRegistryRepository(),
                properties,
                ConfigValueApplicationService.disabled(),
                List.of(new ActionDockWorkspaceSystemPlugin(tempDir.toString()))
        );

        assertThatThrownBy(() -> service.upgrade("actiondock-workspace", "plugin.jar", "jar".getBytes()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("系统插件不支持升级: actiondock-workspace");
        assertThatThrownBy(() -> service.uninstall("actiondock-workspace", true))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("系统插件不支持卸载: actiondock-workspace");
        assertThatThrownBy(() -> service.readPluginFile("actiondock-workspace"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("系统插件不支持下载: actiondock-workspace");
        assertThatThrownBy(() -> service.saveConfig("actiondock-workspace", Map.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("系统插件不支持配置: actiondock-workspace");
    }

    @Test
    void listPluginReferencesSkipsUndocumentedSystemPlugins() {
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        InMemoryPluginRegistryRepository repository = new InMemoryPluginRegistryRepository();
        PluginRuntimeService service = new PluginRuntimeService(
                jsonCodec,
                repository,
                properties,
                ConfigValueApplicationService.disabled(),
                List.of(new UndocumentedSystemPlugin())
        );

        assertThat(service.listPluginReferences()).isEmpty();
        assertThat(service.list()).isEmpty();
    }

    @Test
    void invokeIncludesPluginIdAndActionWhenPluginThrowsRuntimeException() {
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(tempDir.toString());
        PluginRuntimeService service = new PluginRuntimeService(
                jsonCodec,
                new InMemoryPluginRegistryRepository(),
                properties,
                ConfigValueApplicationService.disabled(),
                List.of(new FailingSystemPlugin())
        );

        assertThatThrownBy(() -> service.invoke(
                "failing-system-plugin",
                "explode",
                new ScriptDefinition().setId("script-1"),
                new ScriptExecutionContext().setExecutionId("exec-1"),
                Map.of("name", "Alice"),
                Map.of("message", "hi")
        ))
                .isInstanceOf(PluginRuntimeException.class)
                .hasMessage("插件调用失败 failing-system-plugin/explode: downstream boom");
    }

    private Path buildPluginJar(Path destination, String manifestJson) throws IOException {
        return buildPluginJar(
                destination,
                manifestJson,
                org.team4u.actiondock.plugin.template.TemplatePlugin.class,
                org.team4u.actiondock.plugin.template.DemoActionDockPlugin.class,
                org.team4u.actiondock.plugin.template.DemoPluginConfig.class
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
            addResource(outputStream, "META-INF/actiondock/plugins/" + pluginId + ".json", manifestJson);
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
                  "pluginId": "actiondock-demo-plugin",
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

    private ActionDockAiSystemPlugin documentedAiSystemPlugin() {
        AiGateway gateway = new AiGateway() {
            @Override
            public AiChatResponse chat(AiChatRequest request, AiCallContext context) {
                throw new UnsupportedOperationException("Not needed for this test");
            }

            @Override
            public AiStructuredResponse structured(AiStructuredRequest request, AiCallContext context) {
                throw new UnsupportedOperationException("Not needed for this test");
            }

            @Override
            public AiEmbeddingResponse embed(AiEmbeddingRequest request, AiCallContext context) {
                throw new UnsupportedOperationException("Not needed for this test");
            }
        };
        org.team4u.actiondock.ai.api.AiAgentRuntime runtime = new org.team4u.actiondock.ai.api.AiAgentRuntime() {
            @Override
            public AiAgentRunSubmission submit(AiAgentRunRequest request, AiAgentRunContext context) {
                throw new UnsupportedOperationException("Not needed for this test");
            }

            @Override
            public AiAgentRunResult run(AiAgentRunRequest request, AiAgentRunContext context) {
                throw new UnsupportedOperationException("Not needed for this test");
            }

            @Override
            public AiAgentRunResult resume(String runId, AiAgentResumeCommand command) {
                throw new UnsupportedOperationException("Not needed for this test");
            }

            @Override
            public void cancel(String runId) {
                throw new UnsupportedOperationException("Not needed for this test");
            }

            @Override
            public AiAgentRunSnapshot getRun(String runId) {
                throw new UnsupportedOperationException("Not needed for this test");
            }
        };
        return new ActionDockAiSystemPlugin(gateway, runtime);
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

    private static final class UndocumentedSystemPlugin implements ActionDockPlugin {
        @Override
        public String id() {
            return "undocumented-system-plugin";
        }

        @Override
        public Object invoke(String action, ScriptPluginContext context, Map<String, Object> args) {
            throw new UnsupportedOperationException("Not needed for this test");
        }
    }

    private static final class FailingSystemPlugin implements ActionDockPlugin {
        @Override
        public String id() {
            return "failing-system-plugin";
        }

        @Override
        public Object invoke(String action, ScriptPluginContext context, Map<String, Object> args) {
            throw new PluginRuntimeException("downstream boom");
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

    private static final class InMemoryConfigValueRepository implements ConfigValueRepository {
        private final Map<String, ConfigValue> values = new ConcurrentHashMap<>();

        @Override
        public ConfigValue save(ConfigValue configValue) {
            ConfigValue copy = new ConfigValue()
                    .setKey(configValue.getKey())
                    .setValue(configValue.getValue())
                    .setDescription(configValue.getDescription())
                    .setCreatedAt(configValue.getCreatedAt())
                    .setUpdatedAt(configValue.getUpdatedAt());
            values.put(copy.getKey(), copy);
            return copy;
        }

        @Override
        public Optional<ConfigValue> findByKey(String key) {
            return Optional.ofNullable(values.get(key));
        }

        @Override
        public List<ConfigValue> findAll() {
            return new ArrayList<>(values.values());
        }

        @Override
        public void deleteByKey(String key) {
            values.remove(key);
        }
    }

    public static final class EffectiveConfigValidationBootstrap extends Plugin {
        public EffectiveConfigValidationBootstrap(PluginWrapper wrapper) {
            super(wrapper);
        }
    }

    public static final class EffectiveConfigValidationPlugin implements ActionDockPlugin {
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
