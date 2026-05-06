package org.team4u.actiondock.ai.agentscope;

import com.fasterxml.jackson.databind.JsonNode;
import io.agentscope.core.ReActAgent;
import io.agentscope.core.embedding.EmbeddingModel;
import io.agentscope.core.embedding.dashscope.DashScopeTextEmbedding;
import io.agentscope.core.embedding.ollama.OllamaTextEmbedding;
import io.agentscope.core.embedding.openai.OpenAITextEmbedding;
import io.agentscope.core.hook.Hook;
import io.agentscope.core.hook.HookEvent;
import io.agentscope.core.hook.PostCallEvent;
import io.agentscope.core.hook.ReasoningChunkEvent;
import io.agentscope.core.hook.SummaryChunkEvent;
import io.agentscope.core.message.ContentBlock;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.AnthropicChatModel;
import io.agentscope.core.model.ChatModelBase;
import io.agentscope.core.model.ChatResponse;
import io.agentscope.core.model.ChatUsage;
import io.agentscope.core.model.DashScopeChatModel;
import io.agentscope.core.model.ExecutionConfig;
import io.agentscope.core.model.GenerateOptions;
import io.agentscope.core.model.GeminiChatModel;
import io.agentscope.core.model.OpenAIChatModel;
import io.agentscope.core.model.OllamaChatModel;
import io.agentscope.core.model.StructuredOutputReminder;
import io.agentscope.core.skill.AgentSkill;
import io.agentscope.core.skill.SkillBox;
import io.agentscope.core.tool.Toolkit;
import org.team4u.actiondock.ai.api.AiAgentRunObserver;
import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentRunResult;
import org.team4u.actiondock.ai.api.AiAgentSkill;
import org.team4u.actiondock.ai.api.AiAgentSkillRegistry;
import org.team4u.actiondock.ai.api.AiAgentStep;
import org.team4u.actiondock.ai.api.AiCallContext;
import org.team4u.actiondock.ai.api.AiChatRequest;
import org.team4u.actiondock.ai.api.AiChatResponse;
import org.team4u.actiondock.ai.api.AiEmbeddingRequest;
import org.team4u.actiondock.ai.api.AiEmbeddingResponse;
import org.team4u.actiondock.ai.api.AiMessage;
import org.team4u.actiondock.ai.api.AiModelProvider;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiProviderClient;
import org.team4u.actiondock.ai.api.AiRunStatus;
import org.team4u.actiondock.ai.api.AiSecretResolver;
import org.team4u.actiondock.ai.api.AiStepStatus;
import org.team4u.actiondock.ai.api.AiStepType;
import org.team4u.actiondock.ai.api.AiStructuredRequest;
import org.team4u.actiondock.ai.api.AiStructuredResponse;
import org.team4u.actiondock.ai.api.AiTool;
import org.team4u.actiondock.ai.api.AiToolRegistry;
import org.team4u.actiondock.ai.api.AiUsage;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.team4u.actiondock.ai.agentscope.AgentScopeOptions.*;

public class AgentScopeAiProviderClient implements AiProviderClient {
    private static final String PROVIDER_NAME = "AGENTSCOPE";
    private final AiSecretResolver secretResolver;
    private final AiAgentSkillRegistry skillRegistry;

    public AgentScopeAiProviderClient(AiSecretResolver secretResolver) {
        this(secretResolver, null);
    }

    public AgentScopeAiProviderClient(AiSecretResolver secretResolver, AiAgentSkillRegistry skillRegistry) {
        this.secretResolver = Objects.requireNonNull(secretResolver);
        this.skillRegistry = skillRegistry;
    }

    @Override
    public AiChatResponse chat(AiModelProfile profile, AiChatRequest request, AiCallContext context) {
        ChatModelBase model = buildChatModel(profile, false);
        GenerateOptions options = buildGenerateOptions(profile, request == null ? null : request.options(), false);
        List<ChatResponse> responses = block(model.stream(toMessages(request == null ? null : request.messages()), List.of(), options)
                .collectList(), modelCallTimeout(profile, request == null ? null : request.options()));
        String text = responses.stream().map(AgentScopeAiProviderClient::text).reduce("", String::concat);
        ChatUsage usage = lastUsage(responses);
        Map<String, Object> raw = buildResponseMetadata(profile);
        raw.put("responseCount", responses.size());
        raw.put("finishReason", responses.isEmpty() ? null : responses.getLast().getFinishReason());
        return new AiChatResponse(text, toUsage(usage), raw);
    }

    @Override
    public AiStructuredResponse structured(AiModelProfile profile, AiStructuredRequest request, AiCallContext context) {
        Map<String, Object> requestOptions = request == null ? null : request.options();
        ReActAgent agent = buildStructuredAgent(profile, requestOptions);
        Msg result = block(
                agent.call(
                        toMessages(request == null ? null : request.messages()),
                        structuredOutputSchema(request == null ? null : request.outputSchema())
                ),
                modelCallTimeout(profile, requestOptions)
        );
        Map<String, Object> data = structuredData(result);
        Map<String, Object> raw = buildResponseMetadata(profile);
        raw.put("structuredOutputReminder", structuredOutputReminder(mergedOptions(profile.getDefaultOptions(), requestOptions)).name());
        return new AiStructuredResponse(data, toUsage(result == null ? null : result.getChatUsage()), raw);
    }

    @Override
    public AiEmbeddingResponse embed(AiModelProfile profile, AiEmbeddingRequest request, AiCallContext context) {
        EmbeddingModel model = buildEmbeddingModel(profile, request == null ? null : request.options());
        List<List<Double>> embeddings = new ArrayList<>();
        List<String> inputs = request == null || request.input() == null ? List.of() : request.input();
        for (String input : inputs) {
            double[] vector = block(model.embed(TextBlock.builder().text(input == null ? "" : input).build()),
                    modelCallTimeout(profile, request == null ? null : request.options()));
            embeddings.add(Arrays.stream(vector).boxed().toList());
        }
        Map<String, Object> raw = buildResponseMetadata(profile);
        raw.put("dimensions", model.getDimensions());
        return new AiEmbeddingResponse(embeddings, AiUsage.empty(), raw);
    }

    @Override
    public AiAgentRunResult runAgent(AiAgentProfile agentProfile,
                                     AiModelProfile modelProfile,
                                     AiAgentRunRequest request,
                                     AiAgentRunContext context,
                                     AiToolRegistry toolRegistry) {
        return runAgent(agentProfile, modelProfile, request, context, toolRegistry, AiAgentRunObserver.NOOP);
    }

    @Override
    public AiAgentRunResult runAgent(AiAgentProfile agentProfile,
                                     AiModelProfile modelProfile,
                                     AiAgentRunRequest request,
                                     AiAgentRunContext context,
                                     AiToolRegistry toolRegistry,
                                     AiAgentRunObserver observer) {
        ChatModelBase model = buildChatModel(modelProfile, true);
        Map<String, Object> options = mergedOptions(agentProfile.getOptions(), request == null ? null : request.options());
        AtomicInteger stepIndex = new AtomicInteger();
        List<AiAgentStep> steps = Collections.synchronizedList(new ArrayList<>());
        AiAgentRunObserver effectiveObserver = observer == null ? AiAgentRunObserver.NOOP : observer;
        Toolkit toolkit = buildToolkit(agentProfile, request, context, toolRegistry, stepIndex, steps, effectiveObserver);
        SkillBox skillBox = buildSkillBox(agentProfile, toolkit);
        ReActAgent agent = buildReActAgent(agentProfile, model, toolkit, skillBox, modelProfile, options, effectiveObserver);

        long started = System.currentTimeMillis();
        Msg result = block(agent.call(toMessages(request == null ? null : request.messages())),
                outerAgentTimeout(modelProfile, options, context));
        String text = result == null ? "" : result.getTextContent();
        AiUsage usage = result == null ? AiUsage.empty() : toUsage(result.getChatUsage());
        AiAgentStep step = buildFinalReasoningStep(context, stepIndex, modelProfile, text, started);
        steps.add(step);
        effectiveObserver.onTextDelta(text, text);
        return new AiAgentRunResult(null, AiRunStatus.SUCCESS, Map.of("text", text), steps, usage, null);
    }

    private static AiAgentStep buildFinalReasoningStep(AiAgentRunContext context,
                                                       AtomicInteger stepIndex,
                                                       AiModelProfile modelProfile,
                                                       String text,
                                                       long startedAt) {
        return new AiAgentStep(
                UUID.randomUUID().toString(),
                runId(context),
                stepIndex.incrementAndGet(),
                AiStepType.MODEL_REASONING,
                modelProfile.getId(),
                null,
                null,
                Map.of(),
                Map.of("text", text),
                AiStepStatus.SUCCESS,
                System.currentTimeMillis() - startedAt,
                null,
                LocalDateTime.now()
        );
    }

    private ReActAgent buildReActAgent(AiAgentProfile agentProfile,
                                       ChatModelBase model,
                                       Toolkit toolkit,
                                       SkillBox skillBox,
                                       AiModelProfile modelProfile,
                                       Map<String, Object> options,
                                       AiAgentRunObserver observer) {
        return ReActAgent.builder()
                .name(agentProfile.getId())
                .description(agentProfile.getName())
                .sysPrompt(agentProfile.getSystemPrompt())
                .model(model)
                .toolkit(toolkit)
                .skillBox(skillBox)
                .hook(new ProgressHook(observer))
                .maxIters(intOption(options, "maxIters", 6))
                .generateOptions(buildGenerateOptions(modelProfile, options, true))
                .build();
    }

    private Toolkit buildToolkit(AiAgentProfile agentProfile,
                                 AiAgentRunRequest request,
                                 AiAgentRunContext context,
                                 AiToolRegistry toolRegistry,
                                 AtomicInteger stepIndex,
                                 List<AiAgentStep> steps,
                                 AiAgentRunObserver observer) {
        Toolkit toolkit = new Toolkit();
        Map<String, AiTool> tools = new LinkedHashMap<>();
        for (AiTool tool : toolRegistry.listAgentTools(agentProfile)) {
            tools.putIfAbsent(tool.name(), tool);
        }
        tools.values().forEach(tool -> toolkit.registerAgentTool(AgentScopeToolAdapter.adapt(
                tool,
                request,
                context,
                toolRegistry,
                stepIndex,
                steps,
                observer
        )));
        return toolkit;
    }

    private SkillBox buildSkillBox(AiAgentProfile agentProfile, Toolkit toolkit) {
        SkillBox skillBox = new SkillBox(toolkit);
        if (skillRegistry == null || agentProfile == null || agentProfile.getSkillIds().isEmpty()) {
            return skillBox;
        }
        for (String skillId : agentProfile.getSkillIds()) {
            if (skillId == null || skillId.isBlank()) {
                continue;
            }
            skillBox.registerSkill(toAgentSkill(skillRegistry.requireSkill(skillId)));
        }
        return skillBox;
    }

    private static AgentSkill toAgentSkill(AiAgentSkill runtimeSkill) {
        return AgentSkill.builder()
                .name(runtimeSkill.displayName())
                .description(runtimeSkill.description())
                .skillContent(runtimeSkill.skillContent())
                .resources(runtimeSkill.resources())
                .source(runtimeSkill.source())
                .build();
    }

    private ChatModelBase buildChatModel(AiModelProfile profile, boolean streaming) {
        AiModelProvider modelProvider = requireModelProvider(profile);
        String apiKey = resolveApiKey(profile);
        String modelName = requireText(profile.getModelName(), "AI 模型名不能为空");
        String baseUrl = blankToNull(profile.getBaseUrl());
        return switch (modelProvider) {
            case DASHSCOPE -> configureAndBuild(DashScopeChatModel.builder().modelName(modelName).stream(streaming), apiKey, baseUrl).build();
            case OPENAI, OPENAI_COMPATIBLE -> configureAndBuild(OpenAIChatModel.builder().modelName(modelName).stream(streaming), apiKey, baseUrl).build();
            case ANTHROPIC -> configureAndBuild(AnthropicChatModel.builder().modelName(modelName).stream(streaming), apiKey, baseUrl).build();
            case GEMINI -> configureAndBuild(GeminiChatModel.builder().modelName(modelName).streamEnabled(streaming), apiKey, null).build();
            case OLLAMA -> configureAndBuild(OllamaChatModel.builder().modelName(modelName), null, baseUrl).build();
        };
    }

    private static <B> B configureAndBuild(B builder, String apiKey, String baseUrl) {
        configureBuilder(builder, apiKey, baseUrl);
        return builder;
    }

    private ReActAgent buildStructuredAgent(AiModelProfile profile, Map<String, Object> requestOptions) {
        Map<String, Object> options = mergedOptions(profile.getDefaultOptions(), requestOptions);
        return ReActAgent.builder()
                .name("actiondock-structured")
                .description("ActionDock structured output helper")
                .sysPrompt("Return structured output that matches the requested schema.")
                .model(buildChatModel(profile, false))
                .toolkit(new Toolkit())
                .structuredOutputReminder(structuredOutputReminder(options))
                .maxIters(1)
                .generateOptions(buildGenerateOptions(profile, requestOptions, false))
                .build();
    }

    private EmbeddingModel buildEmbeddingModel(AiModelProfile profile, Map<String, Object> requestOptions) {
        AiModelProvider modelProvider = requireModelProvider(profile);
        String apiKey = resolveApiKey(profile);
        String modelName = requireText(profile.getModelName(), "AI Embedding 模型名不能为空");
        String baseUrl = blankToNull(profile.getBaseUrl());
        int dimensions = intOption(mergedOptions(profile.getDefaultOptions(), requestOptions), "dimensions", 0);
        return switch (modelProvider) {
            case DASHSCOPE -> configureAndBuild(DashScopeTextEmbedding.builder().modelName(modelName).dimensions(dimensions), apiKey, baseUrl).build();
            case OPENAI, OPENAI_COMPATIBLE -> configureAndBuild(OpenAITextEmbedding.builder().modelName(modelName).dimensions(dimensions), apiKey, baseUrl).build();
            case OLLAMA -> configureAndBuild(OllamaTextEmbedding.builder().modelName(modelName).dimensions(dimensions), null, baseUrl).build();
            case ANTHROPIC, GEMINI ->
                    throw new UnsupportedOperationException("AgentScope 当前 Embedding 适配未支持模型供应商: " + modelProvider);
        };
    }

    /**
     * 统一配置 Builder 的 apiKey 和 baseUrl，消除 Chat 和 Embedding 配置的重复代码。
     * 所有支持 apiKey 的构建器: DashScope, OpenAI, Anthropic, Gemini, DashScopeTextEmbedding, OpenAITextEmbedding
     * 所有支持 baseUrl 的构建器: DashScope, OpenAI, Anthropic, Ollama, DashScopeTextEmbedding, OpenAITextEmbedding, OllamaTextEmbedding
     */
    private static void configureBuilder(Object builder, String apiKey, String baseUrl) {
        if (apiKey != null) {
            switch (builder) {
                case DashScopeChatModel.Builder b -> b.apiKey(apiKey);
                case OpenAIChatModel.Builder b -> b.apiKey(apiKey);
                case AnthropicChatModel.Builder b -> b.apiKey(apiKey);
                case GeminiChatModel.Builder b -> b.apiKey(apiKey);
                case DashScopeTextEmbedding.Builder b -> b.apiKey(apiKey);
                case OpenAITextEmbedding.Builder b -> b.apiKey(apiKey);
                default -> {}
            }
        }
        if (baseUrl != null) {
            switch (builder) {
                case DashScopeChatModel.Builder b -> b.baseUrl(baseUrl);
                case OpenAIChatModel.Builder b -> b.baseUrl(baseUrl);
                case AnthropicChatModel.Builder b -> b.baseUrl(baseUrl);
                case OllamaChatModel.Builder b -> b.baseUrl(baseUrl);
                case DashScopeTextEmbedding.Builder b -> b.baseUrl(baseUrl);
                case OpenAITextEmbedding.Builder b -> b.baseUrl(baseUrl);
                case OllamaTextEmbedding.Builder b -> b.baseUrl(baseUrl);
                default -> {}
            }
        }
    }

    private GenerateOptions buildGenerateOptions(AiModelProfile profile, Map<String, Object> requestOptions, boolean streaming) {
        Map<String, Object> options = mergedOptions(profile.getDefaultOptions(), requestOptions);
        GenerateOptions.Builder builder = GenerateOptions.builder()
                .modelName(profile.getModelName())
                .stream(streaming)
                .temperature(doubleOption(options, "temperature"))
                .topP(doubleOption(options, "topP"))
                .maxTokens(intOption(options, "maxTokens"))
                .maxCompletionTokens(intOption(options, "maxCompletionTokens"))
                .frequencyPenalty(doubleOption(options, "frequencyPenalty"))
                .presencePenalty(doubleOption(options, "presencePenalty"))
                .thinkingBudget(intOption(options, "thinkingBudget"))
                .reasoningEffort(stringOption(options, "reasoningEffort"))
                .topK(intOption(options, "topK"))
                .seed(longOption(options, "seed"));
        String apiKey = resolveApiKey(profile);
        if (apiKey != null) {
            builder.apiKey(apiKey);
        }
        String baseUrl = blankToNull(profile.getBaseUrl());
        if (baseUrl != null) {
            builder.baseUrl(baseUrl);
        }
        Integer timeoutSeconds = intOption(options, "timeoutSeconds");
        if (timeoutSeconds != null && timeoutSeconds > 0) {
            builder.executionConfig(ExecutionConfig.builder().timeout(Duration.ofSeconds(timeoutSeconds)).build());
        }
        Object additionalBodyParams = options.get("additionalBodyParams");
        if (additionalBodyParams instanceof Map<?, ?> map) {
            map.forEach((key, value) -> builder.additionalBodyParam(String.valueOf(key), value));
        }
        return builder.build();
    }

    static String runId(AiAgentRunContext context) {
        return context == null || context.metadata() == null ? null : AgentScopeOptions.toStringOrNull(context.metadata().get("agentRunId"));
    }

    private final class ProgressHook implements Hook {
        private final AiAgentRunObserver observer;

        private ProgressHook(AiAgentRunObserver observer) {
            this.observer = observer;
        }

        @Override
        public <T extends HookEvent> Mono<T> onEvent(T event) {
            switch (event) {
                case ReasoningChunkEvent e -> observer.onTextDelta(
                        textValue(e.getIncrementalChunk()),
                        textValue(e.getAccumulated()));
                case SummaryChunkEvent e -> observer.onTextDelta(
                        textValue(e.getIncrementalChunk()),
                        textValue(e.getAccumulated()));
                case PostCallEvent e -> {
                    String text = textValue(e.getFinalMessage());
                    observer.onTextDelta(text, text);
                }
                default -> {}
            }
            return Mono.just(event);
        }
    }

    private static Map<String, Object> buildResponseMetadata(AiModelProfile profile) {
        Map<String, Object> raw = new LinkedHashMap<>();
        raw.put("provider", PROVIDER_NAME);
        raw.put("modelProvider", String.valueOf(profile.getModelProvider()));
        raw.put("model", profile.getModelName());
        return raw;
    }

    private static String textValue(Msg message) {
        return message == null ? "" : message.getTextContent();
    }

    private static List<Msg> toMessages(List<AiMessage> messages) {
        if (messages == null || messages.isEmpty()) {
            return List.of();
        }
        return messages.stream()
                .map(message -> Msg.builder()
                        .role(toRole(message.role()))
                        .textContent(message.content() == null ? "" : message.content())
                        .build())
                .toList();
    }

    private static MsgRole toRole(String role) {
        if (role == null) {
            return MsgRole.USER;
        }
        return switch (role.trim().toLowerCase()) {
            case "system" -> MsgRole.SYSTEM;
            case "assistant" -> MsgRole.ASSISTANT;
            case "tool" -> MsgRole.TOOL;
            default -> MsgRole.USER;
        };
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> structuredData(Msg message) {
        if (message == null || !message.hasStructuredData()) {
            throw new IllegalStateException("AI structured 输出缺少结构化数据");
        }
        Map<String, Object> data = message.getStructuredData(true);
        if (data == null || data.isEmpty()) {
            throw new IllegalStateException("AI structured 输出为空");
        }
        return data;
    }

    private static JsonNode structuredOutputSchema(Map<String, Object> outputSchema) {
        try {
            return AgentScopeOptions.OBJECT_MAPPER.valueToTree(
                    outputSchema == null || outputSchema.isEmpty()
                            ? Map.of("type", "object")
                            : outputSchema
            );
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("AI structured 输出 Schema 无法转换: " + exception.getMessage(), exception);
        }
    }

    private static StructuredOutputReminder structuredOutputReminder(Map<String, Object> options) {
        String reminder = stringOption(options, "structuredOutputReminder");
        String normalized = reminder == null ? "TOOL_CHOICE" : reminder.trim().toUpperCase();
        return switch (normalized) {
            case "TOOL_CHOICE" -> StructuredOutputReminder.TOOL_CHOICE;
            case "PROMPT" -> StructuredOutputReminder.PROMPT;
            default -> throw new IllegalArgumentException("Unsupported structuredOutputReminder: " + reminder);
        };
    }

    private static String text(ChatResponse response) {
        if (response == null || response.getContent() == null) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        for (ContentBlock block : response.getContent()) {
            if (block instanceof TextBlock textBlock) {
                builder.append(textBlock.getText());
            } else if (block != null) {
                builder.append(block);
            }
        }
        return builder.toString();
    }

    private static ChatUsage lastUsage(List<ChatResponse> responses) {
        if (responses == null || responses.isEmpty()) {
            return null;
        }
        for (int i = responses.size() - 1; i >= 0; i--) {
            if (responses.get(i).getUsage() != null) {
                return responses.get(i).getUsage();
            }
        }
        return null;
    }

    private static AiUsage toUsage(ChatUsage usage) {
        if (usage == null) {
            return AiUsage.empty();
        }
        return new AiUsage(usage.getInputTokens(), usage.getOutputTokens(), usage.getTotalTokens());
    }

    private String resolveApiKey(AiModelProfile profile) {
        String key = blankToNull(profile.getApiKeyConfigKey());
        if (key == null) {
            return null;
        }
        String value = blankToNull(secretResolver.resolve(key));
        if (value == null) {
            throw new IllegalArgumentException("AI API Key 配置值不存在或为空: " + key);
        }
        return value;
    }

    private static AiModelProvider requireModelProvider(AiModelProfile profile) {
        if (profile.getModelProvider() == null) {
            throw new IllegalArgumentException("AI 模型供应商不能为空: " + profile.getId());
        }
        return profile.getModelProvider();
    }

    private static Map<String, Object> mergedOptions(Map<String, Object> left, Map<String, Object> right) {
        Map<String, Object> merged = new LinkedHashMap<>();
        if (left != null) {
            merged.putAll(left);
        }
        if (right != null) {
            merged.putAll(right);
        }
        return merged;
    }

    private static Duration modelCallTimeout(AiModelProfile profile, Map<String, Object> requestOptions) {
        Integer timeoutSeconds = intOption(mergedOptions(profile.getDefaultOptions(), requestOptions), "timeoutSeconds");
        return timeoutSeconds == null || timeoutSeconds <= 0 ? null : Duration.ofSeconds(timeoutSeconds);
    }

    private static Duration outerAgentTimeout(AiModelProfile profile, Map<String, Object> requestOptions, AiAgentRunContext context) {
        return disableOuterTimeout(context) ? null : modelCallTimeout(profile, requestOptions);
    }

    private static boolean disableOuterTimeout(AiAgentRunContext context) {
        if (context == null || context.metadata() == null) {
            return false;
        }
        return Boolean.TRUE.equals(context.metadata().get(AiAgentRunContext.DISABLE_OUTER_TIMEOUT_METADATA_KEY));
    }

    private static <T> T block(reactor.core.publisher.Mono<T> mono, Duration timeout) {
        return timeout == null ? mono.block() : mono.block(timeout);
    }
}
