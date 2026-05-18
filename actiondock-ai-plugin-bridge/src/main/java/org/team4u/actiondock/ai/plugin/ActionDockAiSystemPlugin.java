package org.team4u.actiondock.ai.plugin;

import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentRuntime;
import org.team4u.actiondock.ai.api.AiCallContext;
import org.team4u.actiondock.ai.api.AiCallerType;
import org.team4u.actiondock.ai.api.AiChatRequest;
import org.team4u.actiondock.ai.api.AiEmbeddingRequest;
import org.team4u.actiondock.ai.api.AiGateway;
import org.team4u.actiondock.ai.api.AiMessage;
import org.team4u.actiondock.ai.api.AiStructuredRequest;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.List;
import java.util.Map;

public class ActionDockAiSystemPlugin implements ActionDockPlugin {
    public static final String PLUGIN_ID = "actiondock-ai";

    private final AiGateway aiGateway;
    private final AiAgentRuntime aiAgentRuntime;

    public ActionDockAiSystemPlugin(AiGateway aiGateway, AiAgentRuntime aiAgentRuntime) {
        this.aiGateway = aiGateway;
        this.aiAgentRuntime = aiAgentRuntime;
    }

    @Override
    public String id() {
        return PLUGIN_ID;
    }

    @Override
    public Object invoke(String action, ScriptPluginContext context, Map<String, Object> args) {
        Map<String, Object> values = args == null ? Map.of() : args;
        return switch (action) {
            case "chat" -> aiGateway.chat(toChatRequest(values), toCallContext(context));
            case "structured" -> aiGateway.structured(toStructuredRequest(values), toCallContext(context));
            case "embed" -> aiGateway.embed(toEmbeddingRequest(values), toCallContext(context));
            case "agentRun" -> aiAgentRuntime.run(toAgentRunRequest(values), toAgentRunContext(context));
            default -> throw new IllegalArgumentException("Unsupported AI action: " + action);
        };
    }

    private static AiChatRequest toChatRequest(Map<String, Object> values) {
        return new AiChatRequest(stringValue(values.get("modelProfile")), messages(values.get("messages")), mapValue(values.get("options")));
    }

    private static AiStructuredRequest toStructuredRequest(Map<String, Object> values) {
        return new AiStructuredRequest(
                stringValue(values.get("modelProfile")),
                messages(values.get("messages")),
                mapValue(values.get("outputSchema")),
                mapValue(values.get("options"))
        );
    }

    private static AiEmbeddingRequest toEmbeddingRequest(Map<String, Object> values) {
        Object input = values.get("input");
        List<String> items = input instanceof List<?> list
                ? list.stream().map(String::valueOf).toList()
                : List.of(String.valueOf(input == null ? "" : input));
        return new AiEmbeddingRequest(stringValue(values.get("modelProfile")), items, mapValue(values.get("options")));
    }

    private static AiAgentRunRequest toAgentRunRequest(Map<String, Object> values) {
        return new AiAgentRunRequest(
                stringValue(values.get("agentProfile")),
                messages(values.get("messages")),
                mapValue(values.get("input")),
                mapValue(values.get("options"))
        );
    }

    private static AiCallContext toCallContext(ScriptPluginContext context) {
        return new AiCallContext(
                AiCallerType.SCRIPT,
                context == null ? null : context.getScriptId(),
                context == null ? null : context.getExecutionId(),
                PLUGIN_ID,
                null,
                null,
                null,
                Map.of()
        );
    }

    private static AiAgentRunContext toAgentRunContext(ScriptPluginContext context) {
        return new AiAgentRunContext(
                AiCallerType.SCRIPT,
                context == null ? null : context.getScriptId(),
                context == null ? null : context.getExecutionId(),
                null,
                Map.of()
        );
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mapValue(Object value) {
        return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    @SuppressWarnings("unchecked")
    private static List<AiMessage> messages(Object value) {
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        return list.stream()
                .filter(Map.class::isInstance)
                .map(item -> {
                    Map<String, Object> map = (Map<String, Object>) item;
                    return new AiMessage(stringValue(map.get("role")), stringValue(map.get("content")));
                })
                .toList();
    }

    private static String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
