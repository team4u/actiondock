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

/**
 * ActionDock AI 系统插件，为脚本提供 AI 能力调用入口。
 * <p>
 * 本插件实现了 {@link ActionDockPlugin} 接口，作为系统插件注册，使 Agent 脚本
 * 能够通过标准的插件调用机制访问 AI 服务，包括对话聊天、结构化输出、文本向量化
 * 以及 Agent 运行等能力。插件根据 action 类型将请求路由至
 * {@link AiGateway} 或 {@link AiAgentRuntime} 进行处理。
 *
 * @author jay.wu
 */
public class ActionDockAiSystemPlugin implements ActionDockPlugin {

    /** 插件唯一标识符 */
    public static final String PLUGIN_ID = "actiondock-ai";

    /** AI 网关，用于对话、结构化输出和向量化等基础 AI 调用 */
    private final AiGateway aiGateway;

    /** AI Agent 运行时，用于多步骤 Agent 执行 */
    private final AiAgentRuntime aiAgentRuntime;

    /**
     * 构造 AI 系统插件实例。
     *
     * @param aiGateway       AI 网关实例
     * @param aiAgentRuntime  AI Agent 运行时实例
     */
    public ActionDockAiSystemPlugin(AiGateway aiGateway, AiAgentRuntime aiAgentRuntime) {
        this.aiGateway = aiGateway;
        this.aiAgentRuntime = aiAgentRuntime;
    }

    /**
     * 返回插件唯一标识符。
     *
     * @return 插件 ID "actiondock-ai"
     */
    @Override
    public String id() {
        return PLUGIN_ID;
    }

    /**
     * 根据 action 类型调用对应的 AI 能力。
     * <p>
     * 支持的 action 包括：
     * <ul>
     *   <li>"chat" - AI 对话聊天</li>
     *   <li>"structured" - AI 结构化输出</li>
     *   <li>"embed" - 文本向量化</li>
     *   <li>"agentRun" - AI Agent 多步骤运行</li>
     * </ul>
     *
     * @param action  操作类型名称
     * @param context 脚本插件上下文，包含脚本 ID 和执行记录 ID
     * @param args    调用参数映射
     * @return AI 调用结果
     * @throws IllegalArgumentException 当 action 类型不被支持时抛出
     */
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

    /**
     * 将参数映射转换为 AI 对话请求对象。
     *
     * @param values 原始参数映射，需包含 modelProfile、messages、options 等键
     * @return 构造完成的 {@link AiChatRequest} 实例
     */
    private static AiChatRequest toChatRequest(Map<String, Object> values) {
        return new AiChatRequest(stringValue(values.get("modelProfile")), messages(values.get("messages")), mapValue(values.get("options")));
    }

    /**
     * 将参数映射转换为 AI 结构化输出请求对象。
     *
     * @param values 原始参数映射，需包含 modelProfile、messages、outputSchema、options 等键
     * @return 构造完成的 {@link AiStructuredRequest} 实例
     */
    private static AiStructuredRequest toStructuredRequest(Map<String, Object> values) {
        return new AiStructuredRequest(
                stringValue(values.get("modelProfile")),
                messages(values.get("messages")),
                mapValue(values.get("outputSchema")),
                mapValue(values.get("options"))
        );
    }

    /**
     * 将参数映射转换为 AI 向量化请求对象。
     * <p>
     * input 参数支持字符串或字符串列表两种形式。
     *
     * @param values 原始参数映射，需包含 modelProfile、input、options 等键
     * @return 构造完成的 {@link AiEmbeddingRequest} 实例
     */
    private static AiEmbeddingRequest toEmbeddingRequest(Map<String, Object> values) {
        Object input = values.get("input");
        List<String> items = input instanceof List<?> list
                ? list.stream().map(String::valueOf).toList()
                : List.of(String.valueOf(input == null ? "" : input));
        return new AiEmbeddingRequest(stringValue(values.get("modelProfile")), items, mapValue(values.get("options")));
    }

    /**
     * 将参数映射转换为 AI Agent 运行请求对象。
     *
     * @param values 原始参数映射，需包含 agentProfile、messages、input、options 等键
     * @return 构造完成的 {@link AiAgentRunRequest} 实例
     */
    private static AiAgentRunRequest toAgentRunRequest(Map<String, Object> values) {
        return new AiAgentRunRequest(
                stringValue(values.get("agentProfile")),
                messages(values.get("messages")),
                mapValue(values.get("input")),
                mapValue(values.get("options"))
        );
    }

    /**
     * 将脚本插件上下文转换为 AI 调用上下文。
     * <p>
     * 调用者类型设置为 {@link AiCallerType#SCRIPT}，表示由脚本发起的 AI 调用。
     *
     * @param context 脚本插件上下文
     * @return 构造完成的 {@link AiCallContext} 实例
     */
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

    /**
     * 将脚本插件上下文转换为 AI Agent 运行上下文。
     * <p>
     * 调用者类型设置为 {@link AiCallerType#SCRIPT}，表示由脚本发起的 Agent 运行。
     *
     * @param context 脚本插件上下文
     * @return 构造完成的 {@link AiAgentRunContext} 实例
     */
    private static AiAgentRunContext toAgentRunContext(ScriptPluginContext context) {
        return new AiAgentRunContext(
                AiCallerType.SCRIPT,
                context == null ? null : context.getScriptId(),
                context == null ? null : context.getExecutionId(),
                null,
                Map.of()
        );
    }

    /**
     * 将对象安全转换为 Map 类型，非 Map 类型返回空映射。
     *
     * @param value 待转换的对象
     * @return 转换后的 Map，或空映射
     */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> mapValue(Object value) {
        return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    /**
     * 将对象转换为 AI 消息列表。
     * <p>
     * 输入应为 Map 列表，每个 Map 包含 "role" 和 "content" 键。
     * 非 Map 元素会被过滤，非列表输入返回空列表。
     *
     * @param value 原始消息数据，预期为 List&lt;Map&lt;String, Object&gt;&gt;
     * @return 解析后的 {@link AiMessage} 列表
     */
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

    /**
     * 将对象安全转换为字符串，null 值返回 null。
     *
     * @param value 待转换的对象
     * @return 字符串值，或 null
     */
    private static String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
