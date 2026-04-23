package org.team4u.scriptflow.script;

import groovy.lang.Script;
import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.application.ScriptInvocationService;
import org.team4u.scriptflow.config.AppProperties;
import org.team4u.scriptflow.domain.model.ExecutionLogLevel;
import org.team4u.scriptflow.domain.model.PublishedScriptSnapshot;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptExecutionContext;
import org.team4u.scriptflow.domain.model.ScriptType;
import org.team4u.scriptflow.domain.port.ScriptEngine;
import org.team4u.scriptflow.domain.port.ScriptRepository;
import org.team4u.scriptflow.plugin.PluginRuntimeService;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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
        ScriptDefinition child = new ScriptDefinition()
                .setId("child")
                .setPublishedSnapshot(new PublishedScriptSnapshot()
                        .setName("Child")
                        .setType(ScriptType.GROOVY)
                        .setSource("return [message: 'Hello, ' + input.name]")
                        .setInputSchema(Map.of("type", "object"))
                        .setOutputSchema(Map.of("type", "object")));
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
        ScriptEngine nestedEngine = new ScriptEngine() {
            @Override
            public void validate(ScriptDefinition definition) {
            }

            @Override
            public Object execute(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext) {
                return Map.of("message", "Hello, " + input.get("name"));
            }
        };
        return new ScriptInvocationService(repository, () -> nestedEngine);
    }
}
