package org.team4u.actiondock.project.knowledge.plugin.executor;

import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentRunResult;
import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.ai.api.AiCallerType;
import org.team4u.actiondock.ai.api.AiMessage;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;
import org.team4u.actiondock.project.knowledge.plugin.ActionDockProjectKnowledgeSystemPlugin;
import org.team4u.actiondock.project.knowledge.plugin.domain.AtomicTask;
import org.team4u.actiondock.project.knowledge.plugin.domain.MaintenanceRequest;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryFacts;
import org.team4u.actiondock.project.knowledge.plugin.domain.TaskResult;
import org.team4u.actiondock.project.knowledge.plugin.parser.AiOutputParser;
import org.team4u.actiondock.project.knowledge.plugin.parser.ParsedAiOutput;

import java.util.List;
import java.util.Map;

public class BuiltinAgentAtomicTaskExecutor implements AtomicTaskExecutor {
    private final AiAgentRuntime aiAgentRuntime;
    private final AtomicTaskExecutor fallback;
    private final AiOutputParser outputParser = new AiOutputParser();

    public BuiltinAgentAtomicTaskExecutor(AiAgentRuntime aiAgentRuntime, AtomicTaskExecutor fallback) {
        this.aiAgentRuntime = aiAgentRuntime;
        this.fallback = fallback;
    }

    @Override
    public TaskResult execute(ScriptPluginContext context, MaintenanceRequest request, RepositoryFacts facts, AtomicTask task, String template) {
        if (aiAgentRuntime == null || request.agentProfile() == null || request.agentProfile().isBlank()) {
            return fallback.execute(context, request, facts, task, template);
        }
        AiAgentRunRequest agentRequest = new AiAgentRunRequest(
                request.agentProfile(),
                List.of(
                        new AiMessage("system", "You execute exactly one project-knowledge atomic task. Return JSON when possible. If unsure, return readable text with evidence."),
                        new AiMessage("user", atomicPrompt(task, template))
                ),
                Map.of("task", task, "repoPath", facts.root().toString()),
                Map.of("taskType", task.taskType())
        );
        AiAgentRunContext agentContext = new AiAgentRunContext(
                AiCallerType.SCRIPT,
                context == null ? null : context.getScriptId(),
                context == null ? null : context.getExecutionId(),
                null,
                Map.of("pluginId", ActionDockProjectKnowledgeSystemPlugin.PLUGIN_ID, "taskId", task.id())
        );
        AiAgentRunResult agentResult = aiAgentRuntime.run(agentRequest, agentContext);
        String raw = agentResult.data() == null ? String.valueOf(agentResult.errorMessage()) : String.valueOf(agentResult.data());
        ParsedAiOutput parsed = outputParser.parse(raw);
        return new TaskResult(task.id(), task.taskType(), parsed.status(), raw, parsed.parsedOutput(), parsed.parseError(), task.outputPath());
    }

    private String atomicPrompt(AtomicTask task, String template) {
        return """
                Atomic task:
                - id: %s
                - type: %s
                - title: %s
                - outputPath: %s

                Evidence:
                %s

                Template constraint:
                %s

                Return JSON with fields: title, summary, evidence, uncertainty, draftMarkdown.
                """.formatted(task.id(), task.taskType(), task.title(), task.outputPath(), task.evidence(), template);
    }
}
