package org.team4u.actiondock.script;

import groovy.lang.Script;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.team4u.actiondock.application.ScriptInvocationService;
import org.team4u.actiondock.application.SharedStateApplicationService;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ExecutionLogLevel;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.model.SharedStateEntry;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.SharedStateRepository;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.nio.file.Files;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GroovyScriptEngineTest {
    @TempDir
    Path tempDir;

    private final GroovyScriptEngine engine = new GroovyScriptEngine();

    @Test
    void validateAcceptsCompilableScripts() {
        assertThatCode(() -> engine.validate(new ScriptDefinition().setSource("return [message: 'ok']")))
                .doesNotThrowAnyException();
    }

    @Test
    void validateRejectsInvalidGroovySource() {
        assertThatThrownBy(() -> engine.validate(new ScriptDefinition().setSource("return [")))
                .isInstanceOf(Exception.class);
    }

    @Test
    void validateAllowsDynamicPluginInvokeArguments() {
        assertThatCode(() -> engine.validate(new ScriptDefinition().setSource("""
                def pluginId = input.pluginId
                def action = input.action
                return plugins.invoke(pluginId, action, [message: "hi"])
                """)))
                .doesNotThrowAnyException();
    }

    @Test
    void validateAllowsDynamicScriptInvokeArguments() {
        assertThatCode(() -> engine.validate(new ScriptDefinition().setSource("""
                def scriptId = input.scriptId
                return scripts.invoke(scriptId, [message: "hi"])
                """)))
                .doesNotThrowAnyException();
    }

    @Test
    void executeEvaluatesScriptAgainstInputMap() {
        Object result = engine.execute(new ScriptDefinition().setSource("return [message: 'Hello, ' + input.name]"), Map.of("name", "Alice"), null);

        assertThat(result).isInstanceOf(Map.class);
        @SuppressWarnings("unchecked")
        Map<String, Object> values = (Map<String, Object>) result;
        assertThat(values).containsEntry("message", "Hello, Alice");
    }

    @Test
    void executeUsesEmptyInputWhenNullPayloadProvided() {
        Object result = engine.execute(new ScriptDefinition().setSource("return input.isEmpty()"), null, null);

        assertThat(result).isEqualTo(true);
    }

    @Test
    void executeReusesCompiledScriptForSameSource() {
        CountingGroovyScriptEngine countingEngine = new CountingGroovyScriptEngine(groovyProperties(), new MutableClock());
        ScriptDefinition definition = new ScriptDefinition().setSource("return [message: 'Hello, ' + input.name]");

        countingEngine.execute(definition, Map.of("name", "Alice"), null);
        countingEngine.execute(definition, Map.of("name", "Bob"), null);

        assertThat(countingEngine.compileCount()).isEqualTo(1);
    }

    @Test
    void validateAndExecuteShareSameCompiledScript() {
        CountingGroovyScriptEngine countingEngine = new CountingGroovyScriptEngine(groovyProperties(), new MutableClock());
        ScriptDefinition definition = new ScriptDefinition().setSource("return [message: 'ok']");

        countingEngine.validate(definition);
        countingEngine.execute(definition, Map.of(), null);

        assertThat(countingEngine.compileCount()).isEqualTo(1);
    }

    @Test
    void executeRecompilesWhenSourceChanges() {
        CountingGroovyScriptEngine countingEngine = new CountingGroovyScriptEngine(groovyProperties(), new MutableClock());

        countingEngine.execute(new ScriptDefinition().setSource("return [value: 1]"), Map.of(), null);
        countingEngine.execute(new ScriptDefinition().setSource("return [value: 2]"), Map.of(), null);

        assertThat(countingEngine.compileCount()).isEqualTo(2);
    }

    @Test
    void executeRecompilesWhenCacheDisabled() {
        AppProperties.Groovy properties = groovyProperties();
        properties.setEnabled(false);
        CountingGroovyScriptEngine countingEngine = new CountingGroovyScriptEngine(properties, new MutableClock());
        ScriptDefinition definition = new ScriptDefinition().setSource("return [message: 'Hello']");

        countingEngine.execute(definition, Map.of(), null);
        countingEngine.execute(definition, Map.of(), null);

        assertThat(countingEngine.compileCount()).isEqualTo(2);
    }

    @Test
    void executeEvictsLeastRecentlyUsedCompiledScriptWhenCacheOverflows() {
        AppProperties.Groovy properties = groovyProperties();
        properties.setCacheMaxSize(1);
        CountingGroovyScriptEngine countingEngine = new CountingGroovyScriptEngine(properties, new MutableClock());

        countingEngine.execute(new ScriptDefinition().setSource("return [value: 1]"), Map.of(), null);
        countingEngine.execute(new ScriptDefinition().setSource("return [value: 2]"), Map.of(), null);
        countingEngine.execute(new ScriptDefinition().setSource("return [value: 1]"), Map.of(), null);

        assertThat(countingEngine.compileCount()).isEqualTo(3);
    }

    @Test
    void executeExpiresCompiledScriptAfterConfiguredIdleWindow() {
        MutableClock clock = new MutableClock();
        AppProperties.Groovy properties = groovyProperties();
        properties.setCacheExpireAfterAccessMinutes(1);
        CountingGroovyScriptEngine countingEngine = new CountingGroovyScriptEngine(properties, clock);
        ScriptDefinition definition = new ScriptDefinition().setSource("return [value: 1]");

        countingEngine.execute(definition, Map.of(), null);
        clock.advance(Duration.ofMinutes(2));
        countingEngine.execute(definition, Map.of(), null);

        assertThat(countingEngine.compileCount()).isEqualTo(2);
    }

    @Test
    void executeSupportsGrabAnnotations() {
        Object result = engine.execute(new ScriptDefinition().setSource("""
                @Grab('org.apache.ivy:ivy:2.5.2')
                import org.apache.ivy.util.StringUtils

                return [joined: StringUtils.join(input.parts, '-')]
                """), Map.of("parts", new String[]{"hello", "grab"}), null);

        assertThat(result).isInstanceOf(Map.class);
        @SuppressWarnings("unchecked")
        Map<String, Object> values = (Map<String, Object>) result;
        assertThat(values).containsEntry("joined", "hello-grab");
    }

    @Test
    void executeWritesLogsThroughInjectedLogger() {
        List<String> logs = new ArrayList<>();
        ScriptExecutionContext context = new ScriptExecutionContext()
                .setLogger((level, message) -> logs.add(level + ":" + message));

        Object result = engine.execute(
                new ScriptDefinition().setSource("""
                        log.info("hello")
                        log.warn(input.name)
                        return [ok: true]
                        """),
                Map.of("name", "Alice"),
                context
        );

        assertThat(result).isEqualTo(Map.of("ok", true));
        assertThat(logs).containsExactly(
                ExecutionLogLevel.INFO + ":hello",
                ExecutionLogLevel.WARN + ":Alice"
        );
    }

    @Test
    void executeExposesConfigBinding() {
        ScriptExecutionContext context = new ScriptExecutionContext()
                .setConfig(Map.of("api_key", "secret-value"));

        Object result = engine.execute(
                new ScriptDefinition().setSource("return [apiKey: config['api_key']]"),
                Map.of(),
                context
        );

        assertThat(result).isEqualTo(Map.of("apiKey", "secret-value"));
    }

    @Test
    void executeExposesContextAndShellBindings() {
        AppProperties properties = new AppProperties();
        Path artifactRoot = tempDir.resolve("runs");
        properties.getExecution().setArtifactRootDir(artifactRoot.toString());
        GroovyScriptEngine shellEngine = new GroovyScriptEngine(
                properties,
                PluginRuntimeService.disabled(),
                ScriptInvocationService.disabled(),
                SharedStateApplicationService.disabled()
        );

        Object result = shellEngine.execute(
                new ScriptDefinition().setSource("""
                        def command = shell.join(["printf", "%s", input.message], [shell: "sh"])
                        def executed = shell.exec(command, [shell: "sh"])
                        return [
                            executionId: context.executionId,
                            artifactDir: context.artifactDir,
                            stdout: executed.stdout,
                            ok: executed.ok
                        ]
                        """),
                Map.of("message", "hello shell"),
                new ScriptExecutionContext().setExecutionId("exec-groovy-shell")
        );

        assertThat(result).isEqualTo(Map.of(
                "executionId", "exec-groovy-shell",
                "artifactDir", artifactRoot.resolve("exec-groovy-shell").toString(),
                "stdout", "hello shell",
                "ok", true
        ));
        assertThat(Files.exists(artifactRoot.resolve("exec-groovy-shell"))).isFalse();
    }

    @Test
    void executeExposesScriptsBinding() {
        GroovyScriptEngine invocationEngine = new GroovyScriptEngine(
                groovyProperties(),
                PluginRuntimeService.disabled(),
                invocationService()
        );

        Object result = invocationEngine.execute(
                new ScriptDefinition()
                        .setId("parent")
                        .setSource("return scripts.invoke('child', [name: input.name])"),
                Map.of("name", "Alice"),
                new ScriptExecutionContext().setScriptStack(List.of("parent"))
        );

        assertThat(result).isEqualTo(Map.of("message", "Hello, Alice"));
    }

    @Test
    void executeNormalizesGStringArgumentsBeforeNestedScriptValidation() {
        GroovyScriptEngine invocationEngine = new GroovyScriptEngine(
                groovyProperties(),
                PluginRuntimeService.disabled(),
                invocationService()
        );

        Object result = invocationEngine.execute(
                new ScriptDefinition()
                        .setId("parent")
                        .setSource("""
                                def schemaName = input.schemaName
                                def fullTableName = "${schemaName}.cbs_audit_flow"
                                return scripts.invoke('child', [name: fullTableName])
                                """),
                Map.of("schemaName", "cap_cbs"),
                new ScriptExecutionContext().setScriptStack(List.of("parent"))
        );

        assertThat(result).isEqualTo(Map.of("message", "Hello, cap_cbs.cbs_audit_flow"));
    }

    @Test
    void executeIncludesNestedScriptAndPluginContextWhenPluginInvocationFails() {
        PluginRuntimeService pluginRuntimeService = new PluginRuntimeService(
                new MinimalJsonCodec(),
                new EmptyPluginRegistryRepository(),
                groovyPluginProperties(),
                org.team4u.actiondock.application.ConfigValueApplicationService.disabled(),
                List.of(new FailingSystemPlugin())
        );
        ScriptDefinition child = publishedChild("return plugins.invoke('failing-system-plugin', 'explode', [message: input.name])");
        GroovyScriptEngine childEngine = new GroovyScriptEngine(
                groovyProperties(),
                pluginRuntimeService,
                ScriptInvocationService.disabled()
        );
        GroovyScriptEngine parentEngine = new GroovyScriptEngine(
                groovyProperties(),
                pluginRuntimeService,
                invocationService(child, childEngine)
        );

        assertThatThrownBy(() -> parentEngine.execute(
                new ScriptDefinition()
                        .setId("parent")
                        .setSource("return scripts.invoke('child', [name: input.name])"),
                Map.of("name", "Alice"),
                new ScriptExecutionContext().setScriptStack(List.of("parent"))
        ))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("调用脚本 child 失败: 插件调用失败 failing-system-plugin/explode: downstream boom");
    }

    @Test
    void executeExposesStateBinding() {
        SharedStateApplicationService stateService = new SharedStateApplicationService(new InMemorySharedStateRepository());
        GroovyScriptEngine stateEngine = new GroovyScriptEngine(
                groovyProperties(),
                PluginRuntimeService.disabled(),
                ScriptInvocationService.disabled(),
                stateService
        );

        Object result = stateEngine.execute(
                new ScriptDefinition()
                        .setId("state-script")
                        .setSource("""
                                def saved = state.put("oauth.github", "token", [accessToken: input.token], [secret: true, ttlSeconds: 60])
                                def loaded = state.get("oauth.github", "token")
                                return [savedVersion: saved.version, loadedValue: loaded.value.accessToken, secret: loaded.secret]
                                """),
                Map.of("token", "abc"),
                new ScriptExecutionContext().setExecutionId("exec-1")
        );

        assertThat(result).isEqualTo(Map.of(
                "savedVersion", 1L,
                "loadedValue", "abc",
                "secret", true
        ));
    }

    @Test
    void executeCompilesSameSourceOnlyOnceUnderConcurrentFirstHit() throws Exception {
        BlockingGroovyScriptEngine countingEngine = new BlockingGroovyScriptEngine(groovyProperties(), new MutableClock());
        ScriptDefinition definition = new ScriptDefinition().setSource("return [message: 'Hello, ' + input.name]");
        ExecutorService executor = Executors.newFixedThreadPool(2);

        try {
            Future<Object> first = executor.submit(() -> countingEngine.execute(definition, Map.of("name", "Alice"), null));
            assertThat(countingEngine.awaitCompileStart()).isTrue();
            Future<Object> second = executor.submit(() -> countingEngine.execute(definition, Map.of("name", "Bob"), null));

            Thread.sleep(100);
            countingEngine.releaseCompile();

            assertThat(first.get(5, TimeUnit.SECONDS)).isEqualTo(Map.of("message", "Hello, Alice"));
            assertThat(second.get(5, TimeUnit.SECONDS)).isEqualTo(Map.of("message", "Hello, Bob"));
            assertThat(countingEngine.compileCount()).isEqualTo(1);
        } finally {
            executor.shutdownNow();
        }
    }

    private static AppProperties.Groovy groovyProperties() {
        return new AppProperties.Groovy();
    }

    private static AppProperties.Plugins groovyPluginProperties() {
        AppProperties.Plugins properties = new AppProperties.Plugins();
        properties.setDir(System.getProperty("java.io.tmpdir") + "/actiondock-groovy-test-plugins");
        return properties;
    }

    private static class CountingGroovyScriptEngine extends GroovyScriptEngine {
        private final AtomicInteger compileCount = new AtomicInteger();

        private CountingGroovyScriptEngine(AppProperties.Groovy properties, Clock clock) {
            super(properties, clock, PluginRuntimeService.disabled(), ScriptInvocationService.disabled());
        }

        @Override
        protected Class<? extends Script> compileScriptClass(String source) {
            compileCount.incrementAndGet();
            return super.compileScriptClass(source);
        }

        protected int compileCount() {
            return compileCount.get();
        }
    }

    private static final class InMemorySharedStateRepository implements SharedStateRepository {
        private final Map<String, SharedStateEntry> values = new LinkedHashMap<>();

        @Override
        public SharedStateEntry save(SharedStateEntry entry) {
            SharedStateEntry copy = copy(entry);
            values.put(id(entry.getNamespace(), entry.getKey()), copy);
            return copy(copy);
        }

        @Override
        public Optional<SharedStateEntry> findByNamespaceAndKey(String namespace, String key) {
            return Optional.ofNullable(values.get(id(namespace, key))).map(InMemorySharedStateRepository::copy);
        }

        @Override
        public List<SharedStateEntry> findByNamespace(String namespace) {
            return values.values().stream()
                    .filter(item -> namespace.equals(item.getNamespace()))
                    .map(InMemorySharedStateRepository::copy)
                    .toList();
        }

        @Override
        public List<SharedStateEntry> findAll() {
            return values.values().stream().map(InMemorySharedStateRepository::copy).toList();
        }

        @Override
        public boolean compareAndSet(SharedStateEntry entry, Long expectedVersion) {
            String id = id(entry.getNamespace(), entry.getKey());
            SharedStateEntry current = values.get(id);
            if (current == null || !Objects.equals(current.getVersion(), expectedVersion)) {
                return false;
            }
            values.put(id, copy(entry));
            return true;
        }

        @Override
        public void deleteByNamespaceAndKey(String namespace, String key) {
            values.remove(id(namespace, key));
        }

        @Override
        public long deleteExpired(java.time.LocalDateTime now) {
            return 0;
        }

        @Override
        public long deleteExpired(String namespace, java.time.LocalDateTime now) {
            return 0;
        }

        private static String id(String namespace, String key) {
            return namespace + "\u0000" + key;
        }

        private static SharedStateEntry copy(SharedStateEntry source) {
            return new SharedStateEntry()
                    .setNamespace(source.getNamespace())
                    .setKey(source.getKey())
                    .setValue(source.getValue())
                    .setSecret(source.isSecret())
                    .setVersion(source.getVersion())
                    .setExpiresAt(source.getExpiresAt())
                    .setCreatedAt(source.getCreatedAt())
                    .setUpdatedAt(source.getUpdatedAt())
                    .setLastWriterScriptId(source.getLastWriterScriptId())
                    .setLastWriterExecutionId(source.getLastWriterExecutionId());
        }
    }

    private static final class BlockingGroovyScriptEngine extends CountingGroovyScriptEngine {
        private final CountDownLatch compileStarted = new CountDownLatch(1);
        private final CountDownLatch releaseCompile = new CountDownLatch(1);

        private BlockingGroovyScriptEngine(AppProperties.Groovy properties, Clock clock) {
            super(properties, clock);
        }

        @Override
        protected Class<? extends Script> compileScriptClass(String source) {
            compileStarted.countDown();
            try {
                if (!releaseCompile.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Timed out waiting to release compilation");
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Compilation interrupted", e);
            }
            return super.compileScriptClass(source);
        }

        private boolean awaitCompileStart() throws InterruptedException {
            return compileStarted.await(5, TimeUnit.SECONDS);
        }

        private void releaseCompile() {
            releaseCompile.countDown();
        }
    }

    private static final class MutableClock extends Clock {
        private Instant current = Instant.parse("2026-01-01T00:00:00Z");

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return current;
        }

        private void advance(Duration duration) {
            current = current.plus(duration);
        }
    }

    private static ScriptInvocationService invocationService() {
        ScriptDefinition child = publishedChild("return [message: 'Hello, ' + input.name]");
        ScriptEngine nestedEngine = new ScriptEngine() {
            @Override
            public void validate(ScriptDefinition definition) {
            }

            @Override
            public Object execute(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext) {
                return Map.of("message", "Hello, " + input.get("name"));
            }
        };
        return invocationService(child, nestedEngine);
    }

    private static ScriptDefinition publishedChild(String source) {
        ScriptDefinition child = new ScriptDefinition()
                .setId("child")
                .setName("Child")
                .setType(ScriptType.GROOVY)
                .setSource(source)
                .setInputSchema(Map.of(
                        "type", "object",
                        "required", List.of("name"),
                        "properties", Map.of(
                                "name", Map.of("type", "string", "title", "Name")
                        )
                ))
                .setOutputSchema(Map.of("type", "object"));
        return child.setPublishedRevision(PublishedScriptRevision.fromDraft(child, "child:published:1", 1, java.time.LocalDateTime.now()));
    }

    private static ScriptInvocationService invocationService(ScriptDefinition child, ScriptEngine nestedEngine) {
        ScriptRepository repository = new ScriptRepository() {
            @Override
            public ScriptDefinition save(ScriptDefinition definition) {
                throw new UnsupportedOperationException("Not needed");
            }

            @Override
            public Optional<ScriptDefinition> findById(String id) {
                return "child".equals(id) ? Optional.of(child) : Optional.empty();
            }

            @Override
            public List<ScriptDefinition> findAll() {
                return List.of(child);
            }

            @Override
            public void deleteById(String id) {
                throw new UnsupportedOperationException("Not needed");
            }
        };
        return new ScriptInvocationService(repository, () -> nestedEngine);
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

    private static final class MinimalJsonCodec implements JsonCodec {
        @Override
        public String write(Object value) {
            return value == null ? null : String.valueOf(value);
        }

        @Override
        public <T> T read(String json, Class<T> type) {
            throw new UnsupportedOperationException("Not needed for this test");
        }

        @Override
        public Object readUntyped(String json) {
            throw new UnsupportedOperationException("Not needed for this test");
        }

        @Override
        public <T> List<T> readList(String json, Class<T> elementType) {
            throw new UnsupportedOperationException("Not needed for this test");
        }

        @Override
        public Map<String, Object> readMap(String json) {
            throw new UnsupportedOperationException("Not needed for this test");
        }
    }

    private static final class EmptyPluginRegistryRepository implements PluginRegistryRepository {
        @Override
        public PluginRegistration save(PluginRegistration registration) {
            return registration;
        }

        @Override
        public Optional<PluginRegistration> findByPluginId(String pluginId) {
            return Optional.empty();
        }

        @Override
        public List<PluginRegistration> findAll() {
            return List.of();
        }

        @Override
        public List<PluginRegistration> findEnabled() {
            return List.of();
        }

        @Override
        public void deleteByPluginId(String pluginId) {
        }
    }
}
