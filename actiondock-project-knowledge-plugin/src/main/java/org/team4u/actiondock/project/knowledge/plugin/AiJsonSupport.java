package org.team4u.actiondock.project.knowledge.plugin;

import org.team4u.actiondock.ai.api.*;
import org.team4u.actiondock.plugin.api.PluginObjectMappers;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.List;
import java.util.Map;

/**
 * AI JSON 交互支持。
 *
 * <p>封装对 {@link AiAgentRuntime} 的调用，提供结构化 JSON 输入输出能力。
 * 所有 AI 调用要求返回 JSON 对象，并在调用失败或返回非 JSON 时抛出异常。
 * 当 runtime 为 null 或 profile 为空时，{@link #available(String)} 返回 false，
 * 调用方应回退到确定性策略。
 */
final class AiJsonSupport {
    private final AiAgentRuntime runtime;

    AiJsonSupport(AiAgentRuntime runtime) {
        this.runtime = runtime;
    }

    // 从 AI 运行结果中提取原始文本：优先取 data.text，否则序列化整个 data
    private static String rawText(AiAgentRunResult result) {
        if (result.data() == null) {
            return "";
        }
        Object text = result.data().get("text");
        if (text instanceof String string) {
            return string;
        }
        try {
            return PluginObjectMappers.DEFAULT.writeValueAsString(result.data());
        } catch (Exception exception) {
            return String.valueOf(result.data());
        }
    }

    /**
     * 检查指定 AI profile 是否可用。
     *
     * @param profile AI 配置文件标识
     * @return AI 运行时非空且 profile 非空时返回 {@code true}
     */
    boolean available(String profile) {
        return runtime != null && profile != null && !profile.isBlank();
    }

    /**
     * 调用 AI 并返回结构化 JSON 对象。
     *
     * <p>将 system/user 消息、结构化输入和元数据发送给 AI Agent，
     * 期望返回的 data.text 是一个 JSON 对象字符串。
     *
     * @param context      脚本插件上下文
     * @param profile      AI 配置文件标识
     * @param systemPrompt 系统提示词
     * @param userPrompt   用户提示词
     * @param input        结构化输入数据
     * @param options      运行选项（如 phase、kind）
     * @param metadata     透传元数据（如 pluginId、phase）
     * @return AI 返回的 JSON 对象
     * @throws PluginRuntimeException AI 调用失败或返回非 JSON
     */
    @SuppressWarnings("unchecked")
    Map<String, Object> runJson(ScriptPluginContext context,
                                String profile,
                                String systemPrompt,
                                String userPrompt,
                                Map<String, Object> input,
                                Map<String, Object> options,
                                Map<String, Object> metadata) {
        // 构建多轮消息（system + user），通过 Agent Runtime 发起 AI 调用
        AiAgentRunResult result = runtime.run(
                new AiAgentRunRequest(profile, List.of(
                        new AiMessage("system", systemPrompt),
                        new AiMessage("user", userPrompt)
                ), input, options),
                new AiAgentRunContext(
                        AiCallerType.SCRIPT,
                        context == null ? null : context.getScriptId(),
                        context == null ? null : context.getExecutionId(),
                        null,
                        metadata
                )
        );
        if (result == null || result.status() != AiRunStatus.SUCCESS) {
            throw new PluginRuntimeException("AI run failed: " + (result == null ? "unknown" : result.errorMessage()));
        }
        String raw = rawText(result);
        // 将 AI 返回的文本解析为 JSON 对象，非对象类型或格式错误均抛出异常
        try {
            Object parsed = PluginObjectMappers.DEFAULT.readValue(raw, Object.class);
            if (parsed instanceof Map<?, ?> map) {
                return (Map<String, Object>) map;
            }
            throw new PluginRuntimeException("AI output must be a JSON object.");
        } catch (Exception exception) {
            throw new PluginRuntimeException("AI output is not valid JSON: " + exception.getMessage(), exception);
        }
    }
}
