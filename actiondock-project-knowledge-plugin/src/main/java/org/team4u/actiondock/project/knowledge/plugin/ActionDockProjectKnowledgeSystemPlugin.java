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
 *   <li>{@code generate} — 扫描仓库、生成 staging 文档并在校验通过后正式发布</li>
 *   <li>{@code validate} — 校验知识库文档质量</li>
 * </ul>
 *
 * @author ActionDock
 */
public class ActionDockProjectKnowledgeSystemPlugin implements ActionDockPlugin {

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

    @Override
    public Object invoke(String action, ScriptPluginContext context, Map<String, Object> args) {
        Map<String, Object> values = args == null ? Map.of() : args;
        try {
            return switch (action) {
                case "generate" -> service.generate(context, values);
                case "validate" -> service.validate(values);
                default -> throw new IllegalArgumentException("Unsupported project knowledge action: " + action);
            };
        } catch (PluginRuntimeException exception) {
            // 已知的业务异常直接透传
            throw exception;
        } catch (Exception exception) {
            throw new PluginRuntimeException("Project knowledge action failed: " + exception.getMessage(), exception);
        }
    }
}
