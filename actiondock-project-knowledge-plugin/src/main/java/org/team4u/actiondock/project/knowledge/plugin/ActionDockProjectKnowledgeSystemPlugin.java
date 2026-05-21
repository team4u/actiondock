package org.team4u.actiondock.project.knowledge.plugin;

import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;
import org.team4u.actiondock.project.knowledge.plugin.workflow.ProjectKnowledgeWorkflowService;

import java.util.Map;

/**
 * 项目知识库系统插件。
 *
 * <p>ActionDock 内置系统插件，为 Agent 脚本提供项目知识库的自动初始化和持续维护能力。
 * 插件通过扫描目标仓库结构，规划并执行原子任务，生成和维护项目知识文档。
 *
 * <p>支持以下操作：
 * <ul>
 *   <li>{@code planMaintenance} — 规划知识库维护任务（仅规划不执行）</li>
 *   <li>{@code runMaintenance} — 执行完整的知识库维护工作流</li>
 *   <li>{@code getRun} — 查询历史运行记录</li>
 *   <li>{@code validateKnowledge} — 校验知识库质量</li>
 * </ul>
 *
 * @author ActionDock
 */
public class ActionDockProjectKnowledgeSystemPlugin implements ActionDockPlugin {
    public static final String PLUGIN_ID = "actiondock-project-knowledge";

    private final ProjectKnowledgeWorkflowService workflowService;

    /**
     * 创建无 AI 能力的插件实例，原子任务将使用本地确定性回退策略。
     */
    public ActionDockProjectKnowledgeSystemPlugin() {
        this(null);
    }

    /**
     * 创建支持 AI Agent 运行时的插件实例。
     *
     * @param aiAgentRuntime AI Agent 运行时，为 {@code null} 时使用本地回退策略
     */
    public ActionDockProjectKnowledgeSystemPlugin(AiAgentRuntime aiAgentRuntime) {
        this.workflowService = new ProjectKnowledgeWorkflowService(aiAgentRuntime);
    }

    @Override
    public String id() {
        return PLUGIN_ID;
    }

    /**
     * 调度并执行指定的项目知识库操作。
     *
     * @param action  操作名称（planMaintenance / runMaintenance / getRun / validateKnowledge）
     * @param context 脚本插件上下文
     * @param args    操作参数
     * @return 操作结果
     * @throws PluginRuntimeException 操作执行失败
     * @throws IllegalArgumentException 不支持的操作名称
     */
    @Override
    public Object invoke(String action, ScriptPluginContext context, Map<String, Object> args) {
        Map<String, Object> values = args == null ? Map.of() : args;
        try {
            return switch (action) {
                case "planMaintenance" -> workflowService.planMaintenance(values);
                case "runMaintenance" -> workflowService.runMaintenance(context, values);
                case "getRun" -> workflowService.getRun(values);
                case "validateKnowledge" -> workflowService.validateKnowledge(values);
                default -> throw new IllegalArgumentException("Unsupported project knowledge action: " + action);
            };
        } catch (PluginRuntimeException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new PluginRuntimeException("Project knowledge action failed: " + exception.getMessage(), exception);
        }
    }
}
