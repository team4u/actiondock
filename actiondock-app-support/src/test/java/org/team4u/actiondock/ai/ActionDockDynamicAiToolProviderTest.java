package org.team4u.actiondock.ai;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentRunResult;
import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.ai.api.AiCallerType;
import org.team4u.actiondock.ai.api.AiRunStatus;
import org.team4u.actiondock.ai.api.AiTool;
import org.team4u.actiondock.ai.api.AiToolExecutionContext;
import org.team4u.actiondock.ai.api.AiToolExecutionResult;
import org.team4u.actiondock.ai.tool.ActionDockDynamicAiToolProvider;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.model.ExecutionTriggerSource;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executor;

import static org.assertj.core.api.Assertions.assertThat;

class ActionDockDynamicAiToolProviderTest {
    @Test
    void listsPublishedScriptsAndEnabledAgentsAsTools() {
        InMemoryScriptRepository scripts = new InMemoryScriptRepository();
        scripts.save(publishedScript("published-script", "Published Script"));
        scripts.save(publishedScript("flow-script", "Flow Script", ScriptPackaging.FLOW));
        scripts.save(new ScriptDefinition()
                .setId("draft-script")
                .setName("Draft Script")
                .setType(ScriptType.GROOVY)
                .setSource("return [:]"));
        InMemoryAiAgentProfileRepository agents = new InMemoryAiAgentProfileRepository();
        agents.save(new AiAgentProfile().setId("enabled-agent").setName("Enabled Agent").setDescription("Visible agent description").setModelProfileId("model").setEnabled(true));
        agents.save(new AiAgentProfile().setId("disabled-agent").setName("Disabled Agent").setModelProfileId("model").setEnabled(false));

        ActionDockDynamicAiToolProvider provider = new ActionDockDynamicAiToolProvider(
                scripts,
                agents,
                () -> executionService(scripts, new InMemoryExecutionRepository()),
                () -> new NoopAgentRuntime()
        );

        List<String> toolNames = provider.listTools().stream().map(AiTool::name).toList();

        assertThat(toolNames).contains("script.published-script", "agent.enabled-agent");
        assertThat(toolNames).doesNotContain("script.flow-script", "script.draft-script", "agent.disabled-agent");
        assertThat(provider.findTool("script.flow-script")).isEmpty();
    }

    @Test
    void agentToolDescriptionUsesAgentProfileDescription() {
        InMemoryAiAgentProfileRepository agents = new InMemoryAiAgentProfileRepository();
        agents.save(new AiAgentProfile()
                .setId("described-agent")
                .setName("Described Agent")
                .setDescription("负责处理发布说明和总结任务")
                .setModelProfileId("model")
                .setEnabled(true));

        ActionDockDynamicAiToolProvider provider = new ActionDockDynamicAiToolProvider(
                new InMemoryScriptRepository(),
                agents,
                () -> executionService(new InMemoryScriptRepository(), new InMemoryExecutionRepository()),
                () -> new NoopAgentRuntime()
        );

        String description = provider.findTool("agent.described-agent").orElseThrow().description();

        assertThat(description).contains("Described Agent");
        assertThat(description).contains("负责处理发布说明和总结任务");
    }

    @Test
    void scriptToolCreatesExecutionRecordWithAiAuditMetadata() {
        InMemoryScriptRepository scripts = new InMemoryScriptRepository();
        scripts.save(publishedScript("hello-script", "Hello Script"));
        InMemoryExecutionRepository executions = new InMemoryExecutionRepository();
        ActionDockDynamicAiToolProvider provider = new ActionDockDynamicAiToolProvider(
                scripts,
                new InMemoryAiAgentProfileRepository(),
                () -> executionService(scripts, executions),
                () -> new NoopAgentRuntime()
        );

        AiToolExecutionResult result = provider.findTool("script.hello-script")
                .orElseThrow()
                .invoke(Map.of("name", "Alice"), new AiToolExecutionContext(
                        "run-1",
                        "step-1",
                        AiCallerType.AGENT,
                        "parent-script",
                        "parent-exec",
                        null,
                        Map.of()
                ));

        assertThat(result.success()).isTrue();
        assertThat(result.output())
                .containsEntry("status", "SUCCESS")
                .containsEntry("data", Map.of("message", "Hello Alice"));
        ExecutionRecord execution = executions.findAll().getFirst();
        assertThat(execution.getTriggerSource()).isEqualTo(ExecutionTriggerSource.AI_TOOL);
        assertThat(execution.getAgentRunId()).isEqualTo("run-1");
        assertThat(execution.getAgentStepId()).isEqualTo("step-1");
        assertThat(execution.getStatus()).isEqualTo(ExecutionStatus.SUCCESS);
    }

    @Test
    void agentToolForcesControlledPermissionAndRejectsRecursiveChain() {
        InMemoryAiAgentProfileRepository agents = new InMemoryAiAgentProfileRepository();
        agents.save(new AiAgentProfile().setId("child-agent").setName("Child Agent").setModelProfileId("model").setEnabled(true));
        CapturingAgentRuntime runtime = new CapturingAgentRuntime();
        ActionDockDynamicAiToolProvider provider = new ActionDockDynamicAiToolProvider(
                new InMemoryScriptRepository(),
                agents,
                () -> executionService(new InMemoryScriptRepository(), new InMemoryExecutionRepository()),
                () -> runtime
        );

        AiTool tool = provider.findTool("agent.child-agent").orElseThrow();
        AiToolExecutionResult success = tool.invoke(Map.of(
                "message", "Summarize this",
                "input", Map.of("topic", "release")
        ), new AiToolExecutionContext(
                "run-1",
                "step-1",
                AiCallerType.AGENT,
                null,
                null,
                null,
                Map.of("agentProfile", "parent-agent")
        ));

        assertThat(success.success()).isTrue();
        assertThat(runtime.context.metadata().get("agentProfileChain"))
                .isEqualTo(List.of("parent-agent", "child-agent"));

        AiToolExecutionResult recursive = tool.invoke(Map.of("message", "loop"), new AiToolExecutionContext(
                "run-2",
                "step-2",
                AiCallerType.AGENT,
                null,
                null,
                null,
                Map.of(
                        "agentProfile", "other-agent",
                        "agentProfileChain", List.of("child-agent")
                )
        ));

        assertThat(recursive.success()).isFalse();
        assertThat(recursive.errorMessage()).contains("递归");
    }

    private static ExecutionApplicationService executionService(ScriptRepository scripts, ExecutionRepository executions) {
        Executor executor = Runnable::run;
        return new ExecutionApplicationService(
                scripts,
                executions,
                new ScriptEngine() {
                    @Override
                    public void validate(ScriptDefinition definition) {
                    }

                    @Override
                    public Object execute(ScriptDefinition definition, Map<String, Object> input, org.team4u.actiondock.domain.model.ScriptExecutionContext executionContext) {
                        return Map.of("message", "Hello " + input.get("name"));
                    }
                },
                executor,
                ConfigValueApplicationService.disabled()
        );
    }

    private static ScriptDefinition publishedScript(String id, String name) {
        return publishedScript(id, name, ScriptPackaging.TOOL);
    }

    private static ScriptDefinition publishedScript(String id, String name, ScriptPackaging packaging) {
        ScriptDefinition script = new ScriptDefinition()
                .setId(id)
                .setName(name)
                .setType(ScriptType.GROOVY)
                .setPackaging(packaging)
                .setSource("return [message: 'Hello ' + input.name]")
                .setInputSchema(Map.of(
                        "type", "object",
                        "properties", Map.of("name", Map.of("type", "string"))
                ))
                .setOutputSchema(Map.of(
                        "type", "object",
                        "properties", Map.of("message", Map.of("type", "string"))
                ));
        return script.setPublishedRevision(PublishedScriptRevision.fromDraft(script, id + ":published:1", 1, java.time.LocalDateTime.now()));
    }

    private static class NoopAgentRuntime implements AiAgentRuntime {
        @Override
        public org.team4u.actiondock.ai.api.AiAgentRunSubmission submit(AiAgentRunRequest request, AiAgentRunContext context) {
            throw new UnsupportedOperationException();
        }

        @Override
        public AiAgentRunResult run(AiAgentRunRequest request, AiAgentRunContext context) {
            return new AiAgentRunResult("run-1", AiRunStatus.SUCCESS, Map.of(), List.of(), org.team4u.actiondock.ai.api.AiUsage.empty(), null);
        }

        @Override
        public AiAgentRunResult resume(String runId, org.team4u.actiondock.ai.api.AiAgentResumeCommand command) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void cancel(String runId) {
        }

        @Override
        public org.team4u.actiondock.ai.api.AiAgentRunSnapshot getRun(String runId) {
            throw new UnsupportedOperationException();
        }
    }

    private static final class CapturingAgentRuntime extends NoopAgentRuntime {
        private AiAgentRunContext context;

        @Override
        public AiAgentRunResult run(AiAgentRunRequest request, AiAgentRunContext context) {
            this.context = context;
            return new AiAgentRunResult("run-child", AiRunStatus.SUCCESS, Map.of("ok", true), List.of(), org.team4u.actiondock.ai.api.AiUsage.empty(), null);
        }
    }

    private static final class InMemoryScriptRepository implements ScriptRepository {
        private final Map<String, ScriptDefinition> values = new LinkedHashMap<>();

        @Override
        public ScriptDefinition save(ScriptDefinition definition) {
            values.put(definition.getId(), definition);
            return definition;
        }

        @Override
        public Optional<ScriptDefinition> findById(String id) {
            return Optional.ofNullable(values.get(id));
        }

        @Override
        public List<ScriptDefinition> findAll() {
            return new ArrayList<>(values.values());
        }

        @Override
        public void deleteById(String id) {
            values.remove(id);
        }
    }

    private static final class InMemoryExecutionRepository implements ExecutionRepository {
        private final Map<String, ExecutionRecord> values = new LinkedHashMap<>();

        @Override
        public ExecutionRecord save(ExecutionRecord record) {
            values.put(record.getId(), record);
            return record;
        }

        @Override
        public Optional<ExecutionRecord> findById(String id) {
            return Optional.ofNullable(values.get(id));
        }

        @Override
        public List<ExecutionRecord> findByScriptId(String scriptId) {
            return values.values().stream().filter(record -> scriptId.equals(record.getScriptId())).toList();
        }

        @Override
        public List<ExecutionRecord> findAll() {
            return new ArrayList<>(values.values());
        }

        @Override
        public void deleteById(String id) {
            values.remove(id);
        }

        @Override
        public List<ExecutionRecord> findByScheduleId(String scheduleId) {
            return List.of();
        }

        @Override
        public void deleteByScriptId(String scriptId) {
            values.values().removeIf(record -> scriptId.equals(record.getScriptId()));
        }
    }

    private static final class InMemoryAiAgentProfileRepository implements AiAgentProfileRepository {
        private final Map<String, AiAgentProfile> values = new LinkedHashMap<>();

        @Override
        public AiAgentProfile save(AiAgentProfile profile) {
            values.put(profile.getId(), profile);
            return profile;
        }

        @Override
        public Optional<AiAgentProfile> findById(String id) {
            return Optional.ofNullable(values.get(id));
        }

        @Override
        public List<AiAgentProfile> findAll() {
            return new ArrayList<>(values.values());
        }

        @Override
        public void deleteById(String id) {
            values.remove(id);
        }
    }
}
