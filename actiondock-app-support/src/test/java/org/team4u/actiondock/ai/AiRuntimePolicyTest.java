package org.team4u.actiondock.ai;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunRecord;
import org.team4u.actiondock.ai.api.AiAgentRunRepository;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentRunResult;
import org.team4u.actiondock.ai.api.AiAgentRunSnapshot;
import org.team4u.actiondock.ai.api.AiAgentRunSubmission;
import org.team4u.actiondock.ai.api.AiAgentStep;
import org.team4u.actiondock.ai.api.AiAgentStepRepository;
import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.ai.api.AiCallContext;
import org.team4u.actiondock.ai.api.AiCallerType;
import org.team4u.actiondock.ai.api.AiCapability;
import org.team4u.actiondock.ai.api.AiChatRequest;
import org.team4u.actiondock.ai.api.AiChatResponse;
import org.team4u.actiondock.ai.api.AiEmbeddingRequest;
import org.team4u.actiondock.ai.api.AiEmbeddingResponse;
import org.team4u.actiondock.ai.api.AiMessage;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiModelProvider;
import org.team4u.actiondock.ai.api.AiAgentRunObserver;
import org.team4u.actiondock.ai.api.AiProviderClient;
import org.team4u.actiondock.ai.api.AiRunStatus;
import org.team4u.actiondock.ai.api.AiStepType;
import org.team4u.actiondock.ai.api.AiStructuredRequest;
import org.team4u.actiondock.ai.api.AiStructuredResponse;
import org.team4u.actiondock.ai.api.AiTool;
import org.team4u.actiondock.ai.api.AiToolExecutionContext;
import org.team4u.actiondock.ai.api.AiToolExecutionResult;
import org.team4u.actiondock.ai.api.AiToolPermission;
import org.team4u.actiondock.ai.api.AiToolRegistry;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.ai.api.AiUsage;
import org.team4u.actiondock.ai.core.AiAgentProfileService;
import org.team4u.actiondock.ai.core.AiAgentRuntimeImpl;
import org.team4u.actiondock.ai.core.AiToolRegistryImpl;
import org.team4u.actiondock.ai.tool.ActionDockAiTools;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executor;

import static org.assertj.core.api.Assertions.assertThat;

class AiRuntimePolicyTest {
    private static final String DISABLE_OUTER_TIMEOUT_METADATA_KEY = AiAgentRunContext.DISABLE_OUTER_TIMEOUT_METADATA_KEY;

    @Test
    void builtInToolsExposeCurrentScriptWithoutMutatingStorage() {
        InMemoryScriptRepository scripts = new InMemoryScriptRepository();
        scripts.save(new ScriptDefinition()
                .setId("script-1")
                .setName("Script One")
                .setType(ScriptType.GROOVY)
                .setSource("return [ok: true]")
                .setUpdatedAt(LocalDateTime.parse("2026-04-27T10:00:00")));

        List<AiTool> tools = ActionDockAiTools.create(scripts, new InMemoryExecutionRepository(), new InMemoryPluginRegistryRepository());
        AiTool getCurrentScript = tools.stream()
                .filter(tool -> "get_current_script".equals(tool.name()))
                .findFirst()
                .orElseThrow();

        AiToolExecutionResult result = getCurrentScript.invoke(Map.of(), new AiToolExecutionContext(
                "run-1",
                "step-1",
                AiCallerType.SCRIPT,
                "script-1",
                "exec-1",
                null,
                Map.of("maxToolPermission", "PROPOSE_CHANGE")
        ));

        assertThat(result.success()).isTrue();
        @SuppressWarnings("unchecked")
        Map<String, Object> script = (Map<String, Object>) result.output().get("script");
        assertThat(script)
                .containsEntry("id", "script-1")
                .containsEntry("source", "return [ok: true]");
        assertThat(scripts.findAll()).hasSize(1);
    }

    @Test
    void scriptAgentRunDoesNotInjectPermissionLimit() {
        InMemoryAiModelProfileRepository models = new InMemoryAiModelProfileRepository();
        models.save(new AiModelProfile()
                .setId("model")
                .setName("Model")
                .setModelProvider(AiModelProvider.OPENAI)
                .setModelName("gpt-test")
                .setCapabilities(java.util.Set.of(AiCapability.CHAT)));
        InMemoryAiAgentProfileRepository agents = new InMemoryAiAgentProfileRepository();
        agents.save(new AiAgentProfile()
                .setId("agent")
                .setName("Agent")
                .setModelProfileId("model")
                .setToolsetIds(List.of("controlled-tools")));
        InMemoryAiToolsetRepository toolsets = new InMemoryAiToolsetRepository();
        toolsets.save(new AiToolset()
                .setId("controlled-tools")
                .setName("Controlled Tools")
                .setMaxPermission(AiToolPermission.DANGEROUS_ACTION)
                .setToolNames(List.of("run_script")));
        AiToolRegistryImpl registry = new AiToolRegistryImpl(toolsets, List.of(new TestTool("run_script", AiToolPermission.DANGEROUS_ACTION)));
        CapturingProviderClient providerClient = new CapturingProviderClient();
        AiAgentRuntime runtime = new AiAgentRuntimeImpl(
                new AiAgentProfileService(agents, models),
                models,
                new InMemoryAiAgentRunRepository(),
                new InMemoryAiAgentStepRepository(),
                providerClient,
                registry
        );

        AiAgentRunResult result = runtime.run(
                new AiAgentRunRequest("agent", List.of(new AiMessage("user", "run it")), Map.of(), Map.of()),
                new AiAgentRunContext(AiCallerType.SCRIPT, "script-1", "exec-1", null, Map.of())
        );

        assertThat(result.status()).isEqualTo(AiRunStatus.SUCCESS);
        assertThat(providerClient.context.metadata()).doesNotContainKey("maxToolPermission");
    }

    @Test
    void adminAgentRunDoesNotInjectPermissionLimit() {
        InMemoryAiModelProfileRepository models = new InMemoryAiModelProfileRepository();
        models.save(new AiModelProfile()
                .setId("model")
                .setName("Model")
                .setModelProvider(AiModelProvider.OPENAI)
                .setModelName("gpt-test")
                .setCapabilities(java.util.Set.of(AiCapability.CHAT)));
        InMemoryAiAgentProfileRepository agents = new InMemoryAiAgentProfileRepository();
        agents.save(new AiAgentProfile()
                .setId("agent")
                .setName("Agent")
                .setModelProfileId("model")
                .setToolsetIds(List.of("controlled-tools")));
        InMemoryAiToolsetRepository toolsets = new InMemoryAiToolsetRepository();
        toolsets.save(new AiToolset()
                .setId("controlled-tools")
                .setName("Controlled Tools")
                .setMaxPermission(AiToolPermission.CONTROLLED_ACTION)
                .setToolNames(List.of("run_script")));
        AiToolRegistryImpl registry = new AiToolRegistryImpl(toolsets, List.of(new TestTool("run_script", AiToolPermission.CONTROLLED_ACTION)));
        CapturingProviderClient providerClient = new CapturingProviderClient();
        AiAgentRuntime runtime = new AiAgentRuntimeImpl(
                new AiAgentProfileService(agents, models),
                models,
                new InMemoryAiAgentRunRepository(),
                new InMemoryAiAgentStepRepository(),
                providerClient,
                registry
        );

        AiAgentRunResult result = runtime.run(
                new AiAgentRunRequest("agent", List.of(new AiMessage("user", "run it")), Map.of(), Map.of()),
                AiAgentRunContext.adminTest()
        );

        assertThat(result.status()).isEqualTo(AiRunStatus.SUCCESS);
        assertThat(providerClient.context.metadata()).doesNotContainKey("maxToolPermission");
    }

    @Test
    void agentToolRegistryMergesSameToolFromToolsetAndDirectSelection() {
        InMemoryAiToolsetRepository toolsets = new InMemoryAiToolsetRepository();
        toolsets.save(new AiToolset()
                .setId("shared-tools")
                .setName("Shared Tools")
                .setMaxPermission(AiToolPermission.CONTROLLED_ACTION)
                .setToolNames(List.of("run_script"))
                .setToolOptions(Map.of("run_script", Map.of("baseDir", "/tmp"))));
        AiToolRegistryImpl registry = new AiToolRegistryImpl(toolsets, List.of(new TestTool("run_script", AiToolPermission.CONTROLLED_ACTION)));

        List<AiTool> tools = registry.listAgentTools(new AiAgentProfile()
                .setId("agent")
                .setName("Agent")
                .setToolsetIds(List.of("shared-tools"))
                .setDirectToolNames(List.of("run_script"))
                .setDirectToolOptions(Map.of("run_script", Map.of("baseDir", "/tmp"))));

        assertThat(tools).extracting(AiTool::name).containsExactly("run_script");
    }

    @Test
    void agentRuntimeReturnsFailedRunWhenProviderThrowsAfterRunCreated() {
        InMemoryAiModelProfileRepository models = new InMemoryAiModelProfileRepository();
        models.save(new AiModelProfile()
                .setId("model")
                .setName("Model")
                .setModelProvider(AiModelProvider.OPENAI)
                .setModelName("gpt-test")
                .setCapabilities(java.util.Set.of(AiCapability.CHAT)));
        InMemoryAiAgentProfileRepository agents = new InMemoryAiAgentProfileRepository();
        agents.save(new AiAgentProfile()
                .setId("agent")
                .setName("Agent")
                .setModelProfileId("model")
                .setToolsetIds(List.of()));
        InMemoryAiAgentRunRepository runs = new InMemoryAiAgentRunRepository();
        AiAgentRuntime runtime = new AiAgentRuntimeImpl(
                new AiAgentProfileService(agents, models),
                models,
                runs,
                new InMemoryAiAgentStepRepository(),
                new ThrowingProviderClient("missing api key"),
                new AiToolRegistryImpl(new InMemoryAiToolsetRepository(), List.of())
        );

        AiAgentRunResult result = runtime.run(
                new AiAgentRunRequest("agent", List.of(new AiMessage("user", "run")), Map.of(), Map.of()),
                new AiAgentRunContext(AiCallerType.ADMIN_TEST, "script-1", null, null, Map.of())
        );

        assertThat(result.status()).isEqualTo(AiRunStatus.FAILED);
        assertThat(result.runId()).isNotBlank();
        assertThat(result.errorMessage()).isEqualTo("missing api key");
        assertThat(runs.findById(result.runId()).orElseThrow().getStatus()).isEqualTo(AiRunStatus.FAILED);
    }

    @Test
    void submitCreatesRunningRunBeforeBackgroundExecutionFinishes() {
        InMemoryAiModelProfileRepository models = new InMemoryAiModelProfileRepository();
        models.save(new AiModelProfile()
                .setId("model")
                .setName("Model")
                .setModelProvider(AiModelProvider.OPENAI)
                .setModelName("gpt-test")
                .setCapabilities(java.util.Set.of(AiCapability.CHAT)));
        InMemoryAiAgentProfileRepository agents = new InMemoryAiAgentProfileRepository();
        agents.save(new AiAgentProfile()
                .setId("agent")
                .setName("Agent")
                .setModelProfileId("model")
                .setToolsetIds(List.of()));
        InMemoryAiAgentRunRepository runs = new InMemoryAiAgentRunRepository();
        RecordingExecutor executor = new RecordingExecutor();
        ObserverAwareProviderClient providerClient = new ObserverAwareProviderClient();
        AiAgentRuntimeImpl runtime = new AiAgentRuntimeImpl(
                new AiAgentProfileService(agents, models),
                models,
                runs,
                new InMemoryAiAgentStepRepository(),
                providerClient,
                new AiToolRegistryImpl(new InMemoryAiToolsetRepository(), List.of()),
                executor
        );

        AiAgentRunSubmission submission = runtime.submit(
                new AiAgentRunRequest("agent", List.of(new AiMessage("user", "run")), Map.of(), Map.of()),
                AiAgentRunContext.adminTest()
        );

        assertThat(submission.status()).isEqualTo(AiRunStatus.RUNNING);
        assertThat(runs.findById(submission.runId()).orElseThrow().getStatus()).isEqualTo(AiRunStatus.RUNNING);

        executor.runNext();

        AiAgentRunSnapshot snapshot = runtime.getRun(submission.runId());
        assertThat(snapshot.status()).isEqualTo(AiRunStatus.SUCCESS);
        assertThat(snapshot.outputSummary()).containsEntry("text", "done");
        assertThat(providerClient.context.metadata())
                .containsEntry(DISABLE_OUTER_TIMEOUT_METADATA_KEY, true);
    }

    @Test
    void synchronousRunKeepsOuterTimeoutEnabled() {
        InMemoryAiModelProfileRepository models = new InMemoryAiModelProfileRepository();
        models.save(new AiModelProfile()
                .setId("model")
                .setName("Model")
                .setModelProvider(AiModelProvider.OPENAI)
                .setModelName("gpt-test")
                .setCapabilities(java.util.Set.of(AiCapability.CHAT)));
        InMemoryAiAgentProfileRepository agents = new InMemoryAiAgentProfileRepository();
        agents.save(new AiAgentProfile()
                .setId("agent")
                .setName("Agent")
                .setModelProfileId("model")
                .setToolsetIds(List.of()));
        CapturingProviderClient providerClient = new CapturingProviderClient();
        AiAgentRuntime runtime = new AiAgentRuntimeImpl(
                new AiAgentProfileService(agents, models),
                models,
                new InMemoryAiAgentRunRepository(),
                new InMemoryAiAgentStepRepository(),
                providerClient,
                new AiToolRegistryImpl(new InMemoryAiToolsetRepository(), List.of())
        );

        AiAgentRunResult result = runtime.run(
                new AiAgentRunRequest("agent", List.of(new AiMessage("user", "run")), Map.of(), Map.of()),
                AiAgentRunContext.adminTest()
        );

        assertThat(result.status()).isEqualTo(AiRunStatus.SUCCESS);
        assertThat(providerClient.context.metadata())
                .containsEntry(DISABLE_OUTER_TIMEOUT_METADATA_KEY, false);
    }

    @Test
    void failedProviderPreservesPartialTextFromObserver() {
        InMemoryAiModelProfileRepository models = new InMemoryAiModelProfileRepository();
        models.save(new AiModelProfile()
                .setId("model")
                .setName("Model")
                .setModelProvider(AiModelProvider.OPENAI)
                .setModelName("gpt-test")
                .setCapabilities(java.util.Set.of(AiCapability.CHAT)));
        InMemoryAiAgentProfileRepository agents = new InMemoryAiAgentProfileRepository();
        agents.save(new AiAgentProfile()
                .setId("agent")
                .setName("Agent")
                .setModelProfileId("model")
                .setToolsetIds(List.of()));
        InMemoryAiAgentRunRepository runs = new InMemoryAiAgentRunRepository();
        AiAgentRuntime runtime = new AiAgentRuntimeImpl(
                new AiAgentProfileService(agents, models),
                models,
                runs,
                new InMemoryAiAgentStepRepository(),
                new ObserverThrowingProviderClient("partial answer", "provider boom"),
                new AiToolRegistryImpl(new InMemoryAiToolsetRepository(), List.of())
        );

        AiAgentRunResult result = runtime.run(
                new AiAgentRunRequest("agent", List.of(new AiMessage("user", "run")), Map.of(), Map.of()),
                AiAgentRunContext.adminTest()
        );

        assertThat(result.status()).isEqualTo(AiRunStatus.FAILED);
        assertThat(result.data())
                .containsEntry("text", "partial answer")
                .containsEntry("errorMessage", "provider boom");
        assertThat(runs.findById(result.runId()).orElseThrow().getOutputSummary())
                .containsEntry("text", "partial answer")
                .containsEntry("errorMessage", "provider boom");
    }

    private record TestTool(String name, AiToolPermission permission) implements AiTool {
        @Override
        public String description() {
            return "test tool";
        }

        @Override
        public Map<String, Object> inputSchema() {
            return Map.of("type", "object");
        }

        @Override
        public Map<String, Object> outputSchema() {
            return Map.of("type", "object");
        }

        @Override
        public AiToolExecutionResult invoke(Map<String, Object> input, AiToolExecutionContext context) {
            return AiToolExecutionResult.success(Map.of("ok", true), 1);
        }
    }

    private static class CapturingProviderClient implements AiProviderClient {
        protected AiAgentRunContext context;
        protected AiAgentRunRequest request;

        @Override
        public AiChatResponse chat(AiModelProfile profile, AiChatRequest request, AiCallContext context) {
            return new AiChatResponse("ok", AiUsage.empty(), Map.of());
        }

        @Override
        public AiStructuredResponse structured(AiModelProfile profile, AiStructuredRequest request, AiCallContext context) {
            return new AiStructuredResponse(Map.of("ok", true), AiUsage.empty(), Map.of());
        }

        @Override
        public AiEmbeddingResponse embed(AiModelProfile profile, AiEmbeddingRequest request, AiCallContext context) {
            return new AiEmbeddingResponse(List.of(), AiUsage.empty(), Map.of());
        }

        @Override
        public AiAgentRunResult runAgent(AiAgentProfile agentProfile,
                                         AiModelProfile modelProfile,
                                         AiAgentRunRequest request,
                                         AiAgentRunContext context,
                                         AiToolRegistry toolRegistry) {
            this.context = context;
            this.request = request;
            return new AiAgentRunResult(
                    null,
                    AiRunStatus.SUCCESS,
                    Map.of("text", "done"),
                    List.of(new AiAgentStep("step-1", null, 1, AiStepType.MODEL_REASONING, modelProfile.getId(), null, null, Map.of(), Map.of("text", "done"), "SUCCESS", 1L, null, LocalDateTime.now())),
                    AiUsage.empty(),
                    null
            );
        }
    }

    private static final class ThrowingProviderClient extends CapturingProviderClient {
        private final String message;

        private ThrowingProviderClient(String message) {
            this.message = message;
        }

        @Override
        public AiAgentRunResult runAgent(AiAgentProfile agentProfile,
                                         AiModelProfile modelProfile,
                                         AiAgentRunRequest request,
                                         AiAgentRunContext context,
                                         AiToolRegistry toolRegistry) {
            super.context = context;
            super.request = request;
            throw new IllegalStateException(message);
        }
    }

    private static final class ObserverAwareProviderClient extends CapturingProviderClient {
        @Override
        public AiAgentRunResult runAgent(AiAgentProfile agentProfile,
                                         AiModelProfile modelProfile,
                                         AiAgentRunRequest request,
                                         AiAgentRunContext context,
                                         AiToolRegistry toolRegistry,
                                         AiAgentRunObserver observer) {
            super.context = context;
            super.request = request;
            observer.onTextDelta("done", "done");
            return new AiAgentRunResult(
                    null,
                    AiRunStatus.SUCCESS,
                    Map.of("text", "done"),
                    List.of(),
                    AiUsage.empty(),
                    null
            );
        }
    }

    private static final class ObserverThrowingProviderClient extends CapturingProviderClient {
        private final String partialText;
        private final String message;

        private ObserverThrowingProviderClient(String partialText, String message) {
            this.partialText = partialText;
            this.message = message;
        }

        @Override
        public AiAgentRunResult runAgent(AiAgentProfile agentProfile,
                                         AiModelProfile modelProfile,
                                         AiAgentRunRequest request,
                                         AiAgentRunContext context,
                                         AiToolRegistry toolRegistry,
                                         AiAgentRunObserver observer) {
            super.context = context;
            super.request = request;
            observer.onTextDelta(partialText, partialText);
            throw new IllegalStateException(message);
        }
    }

    private static final class InMemoryAiModelProfileRepository implements AiModelProfileRepository {
        private final Map<String, AiModelProfile> values = new LinkedHashMap<>();
        public AiModelProfile save(AiModelProfile profile) { values.put(profile.getId(), profile); return profile; }
        public Optional<AiModelProfile> findById(String id) { return Optional.ofNullable(values.get(id)); }
        public List<AiModelProfile> findAll() { return new ArrayList<>(values.values()); }
        public void deleteById(String id) { values.remove(id); }
    }

    private static final class InMemoryAiAgentProfileRepository implements AiAgentProfileRepository {
        private final Map<String, AiAgentProfile> values = new LinkedHashMap<>();
        public AiAgentProfile save(AiAgentProfile profile) { values.put(profile.getId(), profile); return profile; }
        public Optional<AiAgentProfile> findById(String id) { return Optional.ofNullable(values.get(id)); }
        public List<AiAgentProfile> findAll() { return new ArrayList<>(values.values()); }
        public void deleteById(String id) { values.remove(id); }
    }

    private static final class InMemoryAiToolsetRepository implements AiToolsetRepository {
        private final Map<String, AiToolset> values = new LinkedHashMap<>();
        public AiToolset save(AiToolset toolset) { values.put(toolset.getId(), toolset); return toolset; }
        public Optional<AiToolset> findById(String id) { return Optional.ofNullable(values.get(id)); }
        public List<AiToolset> findAll() { return new ArrayList<>(values.values()); }
        public void deleteById(String id) { values.remove(id); }
    }

    private static final class InMemoryAiAgentRunRepository implements AiAgentRunRepository {
        private final Map<String, AiAgentRunRecord> values = new LinkedHashMap<>();
        public AiAgentRunRecord save(AiAgentRunRecord run) { values.put(run.getId(), run); return run; }
        public Optional<AiAgentRunRecord> findById(String id) { return Optional.ofNullable(values.get(id)); }
        public List<AiAgentRunRecord> findAll() { return new ArrayList<>(values.values()); }
        public void deleteById(String id) { values.remove(id); }
    }

    private static final class InMemoryAiAgentStepRepository implements AiAgentStepRepository {
        private final Map<String, AiAgentStep> values = new LinkedHashMap<>();
        public AiAgentStep save(AiAgentStep step) { values.put(step.id(), step); return step; }
        public List<AiAgentStep> findByRunId(String runId) { return values.values().stream().filter(step -> runId.equals(step.runId())).toList(); }
        public void deleteByRunId(String runId) { values.entrySet().removeIf(e -> runId.equals(e.getValue().runId())); }
    }

    private static final class RecordingExecutor implements Executor {
        private final List<Runnable> tasks = new ArrayList<>();

        @Override
        public void execute(Runnable command) {
            tasks.add(command);
        }

        private void runNext() {
            Runnable next = tasks.remove(0);
            next.run();
        }
    }

    private static final class InMemoryScriptRepository implements ScriptRepository {
        private final Map<String, ScriptDefinition> values = new LinkedHashMap<>();
        public ScriptDefinition save(ScriptDefinition definition) { values.put(definition.getId(), definition); return definition; }
        public Optional<ScriptDefinition> findById(String id) { return Optional.ofNullable(values.get(id)); }
        public List<ScriptDefinition> findAll() { return new ArrayList<>(values.values()); }
        public void deleteById(String id) { values.remove(id); }
    }

    private static final class InMemoryExecutionRepository implements ExecutionRepository {
        private final Map<String, ExecutionRecord> values = new LinkedHashMap<>();
        public ExecutionRecord save(ExecutionRecord record) { values.put(record.getId(), record); return record; }
        public Optional<ExecutionRecord> findById(String id) { return Optional.ofNullable(values.get(id)); }
        public List<ExecutionRecord> findByScriptId(String scriptId) { return values.values().stream().filter(record -> scriptId.equals(record.getScriptId())).toList(); }
        public List<ExecutionRecord> findAll() { return new ArrayList<>(values.values()); }
        public void deleteById(String id) { values.remove(id); }
        public List<ExecutionRecord> findByScheduleId(String scheduleId) { return values.values().stream().filter(record -> scheduleId.equals(record.getScheduleId())).toList(); }
        public void deleteByScriptId(String scriptId) { values.values().removeIf(record -> scriptId.equals(record.getScriptId())); }
        public void keepLatest(String scriptId, int limit) {
            List<ExecutionRecord> records = values.values().stream()
                    .filter(record -> scriptId.equals(record.getScriptId()))
                    .sorted((r1, r2) -> {
                        if (r1.getCreatedAt() == null) return 1;
                        if (r2.getCreatedAt() == null) return -1;
                        return r2.getCreatedAt().compareTo(r1.getCreatedAt());
                    })
                    .toList();
            if (records.size() > limit) {
                records.subList(limit, records.size()).forEach(record -> values.remove(record.getId()));
            }
        }
    }

    private static final class InMemoryPluginRegistryRepository implements PluginRegistryRepository {
        private final Map<String, PluginRegistration> values = new LinkedHashMap<>();
        public PluginRegistration save(PluginRegistration registration) { values.put(registration.getPluginId(), registration); return registration; }
        public Optional<PluginRegistration> findByPluginId(String pluginId) { return Optional.ofNullable(values.get(pluginId)); }
        public List<PluginRegistration> findAll() { return new ArrayList<>(values.values()); }
        public List<PluginRegistration> findEnabled() { return values.values().stream().filter(PluginRegistration::isEnabled).toList(); }
        public void deleteByPluginId(String pluginId) { values.remove(pluginId); }
    }
}
