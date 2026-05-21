package org.team4u.actiondock.project.knowledge.plugin.executor;

import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentRunResult;
import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.ai.api.AiCallerType;
import org.team4u.actiondock.ai.api.AiMessage;
import org.team4u.actiondock.ai.api.AiRunStatus;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;
import org.team4u.actiondock.plugin.api.PluginObjectMappers;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.project.knowledge.plugin.ActionDockProjectKnowledgeSystemPlugin;
import org.team4u.actiondock.project.knowledge.plugin.domain.AtomicTask;
import org.team4u.actiondock.project.knowledge.plugin.domain.MaintenanceRequest;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryFacts;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryInventory;
import org.team4u.actiondock.project.knowledge.plugin.domain.TaskResult;
import org.team4u.actiondock.project.knowledge.plugin.parser.AiOutputParser;
import org.team4u.actiondock.project.knowledge.plugin.parser.ParsedAiOutput;

import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 内置 AI Agent 原子任务执行器。
 *
 * <p>通过 ActionDock AI Agent 运行时执行原子任务，将任务描述和证据作为 prompt 发送给 AI Agent，
 * 然后解析返回结果。当 AI 运行时不可用或未配置 Agent Profile 时，回退到本地确定性策略。
 *
 * @author ActionDock
 */
public class BuiltinAgentAtomicTaskExecutor implements AtomicTaskExecutor {
    private final AiAgentRuntime aiAgentRuntime;
    private final AtomicTaskExecutor fallback;
    private final AiOutputParser outputParser = new AiOutputParser();

    /**
     * 创建内置 Agent 执行器。
     *
     * @param aiAgentRuntime AI Agent 运行时
     * @param fallback       AI 不可用时的回退执行器
     */
    public BuiltinAgentAtomicTaskExecutor(AiAgentRuntime aiAgentRuntime, AtomicTaskExecutor fallback) {
        this.aiAgentRuntime = aiAgentRuntime;
        this.fallback = fallback;
    }

    /**
     * 通过 AI Agent 执行原子任务。
     *
     * <p>当 {@code aiAgentRuntime} 为 {@code null} 或 {@code agentProfile} 未配置时直接回退。
     * 成功调用后使用 {@link AiOutputParser} 解析 Agent 返回结果。
     *
     * @param context  脚本插件上下文
     * @param request 维护请求
     * @param facts   仓库扫描结果
     * @param task    待执行的原子任务
     * @param template 任务关联的模板内容
     * @return 任务执行结果
     */
    @Override
    public TaskResult execute(ScriptPluginContext context, MaintenanceRequest request, RepositoryFacts facts, AtomicTask task, String template) {
        // AI 运行时不可用或未配置 Agent Profile 时直接回退
        if (aiAgentRuntime == null || request.agentProfile() == null || request.agentProfile().isBlank()) {
            return fallback.execute(context, request, facts, task, template);
        }

        // 构建 Agent 请求：system 指令限定为单任务执行，user prompt 包含任务详情和模板约束
        AiAgentRunRequest agentRequest = new AiAgentRunRequest(
                request.agentProfile(),
                List.of(
                        new AiMessage("system", "You execute exactly one project-knowledge atomic task. Return JSON when possible. If unsure, return readable text with evidence."),
                        new AiMessage("user", atomicPrompt(task, template))
                ),
                Map.of("task", task, "repoPath", facts.root().toString()),
                Map.of("taskType", task.taskType())
        );
        // 构建调用上下文，关联插件 ID 和任务 ID 以便追踪
        AiAgentRunContext agentContext = new AiAgentRunContext(
                AiCallerType.SCRIPT,
                context == null ? null : context.getScriptId(),
                context == null ? null : context.getExecutionId(),
                null,
                Map.of("pluginId", ActionDockProjectKnowledgeSystemPlugin.PLUGIN_ID, "taskId", task.id())
        );

        AiAgentRunResult agentResult = aiAgentRuntime.run(agentRequest, agentContext);

        // 优先取 data 作为原始输出，失败时取 errorMessage
        String raw = rawOutput(agentResult);
        ParsedAiOutput parsed = outputParser.parse(raw);
        return new TaskResult(task.id(), task.taskType(), parsed.status(), raw, parsed.parsedOutput(), parsed.parseError(), task.outputPath());
    }

    @Override
    @SuppressWarnings("unchecked")
    public Map<String, Object> scanRepository(ScriptPluginContext context,
                                              MaintenanceRequest request,
                                              RepositoryInventory inventory,
                                              String prompt) {
        if (aiAgentRuntime == null) {
            throw new PluginRuntimeException("AI runtime is required for repository scan.");
        }
        if (request.agentProfile() == null || request.agentProfile().isBlank()) {
            throw new PluginRuntimeException("agentProfile is required for repository scan.");
        }

        AiAgentRunRequest agentRequest = new AiAgentRunRequest(
                request.agentProfile(),
                List.of(
                        new AiMessage("system", "You classify one repository inventory into structured project-knowledge scan JSON. Return JSON only."),
                        new AiMessage("user", prompt)
                ),
                Map.of("repoPath", inventory.root().toString()),
                Map.of("scanPhase", "repository-classification")
        );
        AiAgentRunContext agentContext = new AiAgentRunContext(
                AiCallerType.SCRIPT,
                context == null ? null : context.getScriptId(),
                context == null ? null : context.getExecutionId(),
                null,
                Map.of("pluginId", ActionDockProjectKnowledgeSystemPlugin.PLUGIN_ID, "phase", "repository-scan")
        );

        AiAgentRunResult result = aiAgentRuntime.run(agentRequest, agentContext);
        if (result.status() != null && result.status() != AiRunStatus.SUCCESS) {
            throw new PluginRuntimeException("Repository scan failed: " + failureMessage(result));
        }
        ParsedAiOutput parsed = outputParser.parse(rawOutput(result));
        if (!parsed.parsed()) {
            throw new PluginRuntimeException("Repository scan returned invalid JSON: " + parsed.parseError());
        }
        return new LinkedHashMap<>(parsed.parsedOutput());
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

    private static String rawOutput(AiAgentRunResult result) {
        if (result == null) {
            return "";
        }
        Map<String, Object> data = result.data();
        if (data == null || data.isEmpty()) {
            return result.errorMessage() == null ? "" : result.errorMessage();
        }
        Object text = data.get("text");
        if (text instanceof String string) {
            return string;
        }
        try {
            return PluginObjectMappers.DEFAULT.writeValueAsString(data);
        } catch (Exception exception) {
            return String.valueOf(data);
        }
    }

    private static String failureMessage(AiAgentRunResult result) {
        String error = result == null ? null : result.errorMessage();
        return error == null || error.isBlank()
                ? "status=" + (result == null || result.status() == null ? "unknown" : result.status().name())
                : error;
    }
}
