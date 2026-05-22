package org.team4u.actiondock.project.knowledge.plugin;

import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.Map;

/**
 * 项目知识库系统插件。
 *
 * <p>ActionDock 的内置系统插件，为 Agent 脚本提供项目知识库的自动化生成与校验能力。
 * 插件以 Spring Bean 注册，始终可用。支持的操作包括：
 * <ul>
 *   <li>{@code init} — 初始化 OCKB 知识库</li>
 *   <li>{@code refresh} — 手工触发增量刷新</li>
 *   <li>{@code ingest} — 导入手工资料</li>
 *   <li>{@code validate} — 校验知识库文档质量</li>
 *   <li>{@code getRun} — 查询异步任务状态</li>
 *   <li>{@code cancelRun} — 取消异步任务</li>
 * </ul>
 *
 * @author ActionDock
 */
public class ActionDockProjectKnowledgeSystemPlugin implements ActionDockPlugin {

    /** 插件唯一标识，用于 PF4J 插件注册和日志追踪。 */
    public static final String PLUGIN_ID = "actiondock-project-knowledge";

    private final ProjectKnowledgeService service;

    /**
     * 无参构造，不启用 AI 能力，使用纯确定性策略。
     */
    public ActionDockProjectKnowledgeSystemPlugin() {
        this(null);
    }

    /**
     * 带 AI 运行时的构造。
     *
     * @param aiAgentRuntime AI Agent 运行时，为 {@code null} 时使用本地回退策略
     */
    public ActionDockProjectKnowledgeSystemPlugin(AiAgentRuntime aiAgentRuntime) {
        this.service = new ProjectKnowledgeService(aiAgentRuntime);
    }

    @Override
    public String id() {
        return PLUGIN_ID;
    }

    /**
     * 插件动作分发入口。
     *
     * <p>支持的动作包括：init（初始化）、refresh（增量刷新）、ingest（资料导入）、
     * validate（质量校验）、getRun（查询异步任务状态）、cancelRun（取消异步任务）。
     * 所有 init/refresh/ingest 操作为异步执行，立即返回 runId。
     */
    @Override
    public Object invoke(String action, ScriptPluginContext context, Map<String, Object> args) {
        Map<String, Object> values = args == null ? Map.of() : args;
        try {
            return switch (action) {
                case "init" -> service.init(context, values);
                case "refresh" -> service.refresh(context, values);
                case "ingest" -> service.ingest(context, values);
                case "validate" -> service.validate(values);
                case "getRun" -> service.getRun(values);
                case "cancelRun" -> service.cancelRun(values);
                default -> throw new IllegalArgumentException("Unsupported project knowledge action: " + action);
            };
        } catch (PluginRuntimeException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new PluginRuntimeException("Project knowledge action failed: " + exception.getMessage(), exception);
        }
    }
}
