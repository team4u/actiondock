package org.team4u.actiondock.project.knowledge.plugin;

import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;
import org.team4u.actiondock.project.knowledge.plugin.workflow.ProjectKnowledgeWorkflowService;

import java.util.Map;

public class ActionDockProjectKnowledgeSystemPlugin implements ActionDockPlugin {
    public static final String PLUGIN_ID = "actiondock-project-knowledge";

    private final ProjectKnowledgeWorkflowService workflowService;

    public ActionDockProjectKnowledgeSystemPlugin() {
        this(null);
    }

    public ActionDockProjectKnowledgeSystemPlugin(AiAgentRuntime aiAgentRuntime) {
        this.workflowService = new ProjectKnowledgeWorkflowService(aiAgentRuntime);
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
