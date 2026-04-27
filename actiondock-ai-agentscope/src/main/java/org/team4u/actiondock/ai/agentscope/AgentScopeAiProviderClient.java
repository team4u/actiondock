package org.team4u.actiondock.ai.agentscope;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import io.agentscope.core.message.ToolResultBlock;
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
import io.agentscope.core.tool.AgentTool;
import io.agentscope.core.tool.ToolCallParam;
import io.agentscope.core.tool.Toolkit;
import org.team4u.actiondock.ai.api.AiAgentRunObserver;
import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiAgentRunRequest;
import org.team4u.actiondock.ai.api.AiAgentRunResult;
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
import org.team4u.actiondock.ai.api.AiStepType;
import org.team4u.actiondock.ai.api.AiStructuredRequest;
import org.team4u.actiondock.ai.api.AiStructuredResponse;
import org.team4u.actiondock.ai.api.AiTool;
import org.team4u.actiondock.ai.api.AiToolExecutionContext;
import org.team4u.actiondock.ai.api.AiToolExecutionResult;
import org.team4u.actiondock.ai.api.AiToolRegistry;
import org.team4u.actiondock.ai.api.AiUsage;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

public class AgentScopeAiProviderClient implements AiProviderClient {
    private static final String DISABLE_OUTER_TIMEOUT_METADATA_KEY = "disableOuterTimeout";
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private final AiSecretResolver secretResolver;

    public AgentScopeAiProviderClient(AiSecretResolver secretResolver) {
        this.secretResolver = Objects.requireNonNull(secretResolver);
    }

    @Override
    public AiChatResponse chat(AiModelProfile profile, AiChatRequest request, AiCallContext context) {
        ChatModelBase model = buildChatModel(profile, false);
        GenerateOptions options = buildGenerateOptions(profile, request == null ? null : request.options(), false);
        List<ChatResponse> responses = block(model.stream(toMessages(request == null ? null : request.messages()), List.of(), options)
                .collectList(), modelCallTimeout(profile, request == null ? null : request.options()));
        String text = responses.stream().map(this::text).reduce("", String::concat);
        ChatUsage usage = lastUsage(responses);
        Map<String, Object> raw = new LinkedHashMap<>();
        raw.put("provider", "AGENTSCOPE");
        raw.put("modelProvider", String.valueOf(profile.getModelProvider()));
        raw.put("model", profile.getModelName());
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
        Map<String, Object> raw = new LinkedHashMap<>();
        raw.put("provider", "AGENTSCOPE");
        raw.put("modelProvider", String.valueOf(profile.getModelProvider()));
        raw.put("model", profile.getModelName());
        raw.put("structuredOutputReminder", structuredOutputReminder(mergedOptions(profile.getDefaultOptions(), requestOptions)).name());
        return new AiStructuredResponse(data, toUsage(result == null ? null : result.getChatUsage()), raw);
    }

    @Override
    public AiEmbeddingResponse embed(AiModelProfile profile, AiEmbeddingRequest request, AiCallContext context) {
        EmbeddingModel model = buildEmbeddingModel(profile, request == null ? null : request.options());
        List<List<Double>> embeddings = new ArrayList<>();
        for (String input : request == null || request.input() == null ? List.<String>of() : request.input()) {
            double[] vector = block(model.embed(TextBlock.builder().text(input == null ? "" : input).build()),
                    modelCallTimeout(profile, request == null ? null : request.options()));
            List<Double> values = new ArrayList<>(vector.length);
            for (double item : vector) {
                values.add(item);
            }
            embeddings.add(values);
        }
        return new AiEmbeddingResponse(embeddings, AiUsage.empty(), Map.of(
                "provider", "AGENTSCOPE",
                "modelProvider", String.valueOf(profile.getModelProvider()),
                "model", profile.getModelName(),
                "dimensions", model.getDimensions()
        ));
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
        Toolkit toolkit = buildToolkit(agentProfile, request, context, toolRegistry, stepIndex, steps, observer == null ? AiAgentRunObserver.NOOP : observer);
        ReActAgent agent = ReActAgent.builder()
                .name(agentProfile.getId())
                .description(agentProfile.getName())
                .sysPrompt(agentProfile.getSystemPrompt())
                .model(model)
                .toolkit(toolkit)
                .hook(new ProgressHook(observer == null ? AiAgentRunObserver.NOOP : observer))
                .maxIters(intOption(options, "maxIters", 6))
                .generateOptions(buildGenerateOptions(modelProfile, options, true))
                .build();

        long started = System.currentTimeMillis();
        Msg result = block(agent.call(toMessages(request == null ? null : request.messages())),
                outerAgentTimeout(modelProfile, options, context));
        String text = result == null ? "" : result.getTextContent();
        AiUsage usage = result == null ? AiUsage.empty() : toUsage(result.getChatUsage());
        AiAgentStep step = new AiAgentStep(
                UUID.randomUUID().toString(),
                runId(context),
                stepIndex.incrementAndGet(),
                AiStepType.MODEL_REASONING,
                modelProfile.getId(),
                null,
                null,
                Map.of(),
                Map.of("text", text),
                "SUCCESS",
                System.currentTimeMillis() - started,
                null,
                LocalDateTime.now()
        );
        steps.add(step);
        observer.onTextDelta(text, text);
        return new AiAgentRunResult(null, AiRunStatus.SUCCESS, Map.of("text", text), steps, usage, null);
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
        for (String toolsetId : agentProfile.getToolsetIds()) {
            for (AiTool tool : toolRegistry.listTools(toolsetId)) {
                tools.putIfAbsent(tool.name(), tool);
            }
        }
        tools.values().forEach(tool -> toolkit.registerAgentTool(new ActionDockAgentTool(
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

    private final class ActionDockAgentTool implements AgentTool {
        private final AiTool tool;
        private final AiAgentRunRequest request;
        private final AiAgentRunContext context;
        private final AiToolRegistry toolRegistry;
        private final AtomicInteger stepIndex;
        private final List<AiAgentStep> steps;
        private final AiAgentRunObserver observer;

        private ActionDockAgentTool(AiTool tool,
                                    AiAgentRunRequest request,
                                    AiAgentRunContext context,
                                    AiToolRegistry toolRegistry,
                                    AtomicInteger stepIndex,
                                    List<AiAgentStep> steps,
                                    AiAgentRunObserver observer) {
            this.tool = tool;
            this.request = request;
            this.context = context;
            this.toolRegistry = toolRegistry;
            this.stepIndex = stepIndex;
            this.steps = steps;
            this.observer = observer;
        }

        @Override
        public String getName() {
            return tool.name();
        }

        @Override
        public String getDescription() {
            return tool.description();
        }

        @Override
        public Map<String, Object> getParameters() {
            return tool.inputSchema() == null ? Map.of() : tool.inputSchema();
        }

        @Override
        public Mono<ToolResultBlock> callAsync(ToolCallParam param) {
            String stepId = UUID.randomUUID().toString();
            Map<String, Object> input = param == null || param.getInput() == null ? Map.of() : param.getInput();
            AiAgentStep startStep = new AiAgentStep(
                    stepId,
                    runId(context),
                    stepIndex.incrementAndGet(),
                    AiStepType.TOOL_CALL,
                    null,
                    tool.name(),
                    tool.permission(),
                    input,
                    Map.of(),
                    "RUNNING",
                    null,
                    null,
                    LocalDateTime.now()
            );
            steps.add(startStep);
            observer.onStep(startStep);
            AiToolExecutionResult result = toolRegistry.invoke(tool.name(), input, new AiToolExecutionContext(
                    context == null || context.metadata() == null ? null : stringValue(context.metadata().get("agentRunId")),
                    stepId,
                    context == null ? null : context.callerType(),
                    context == null ? null : context.scriptId(),
                    context == null ? null : context.executionId(),
                    context == null ? null : context.userId(),
                    toolMetadata(request, context, param)
            ));
            String resultStepId = UUID.randomUUID().toString();
            Map<String, Object> output = result.output() == null ? Map.of() : result.output();
            AiAgentStep resultStep = new AiAgentStep(
                    resultStepId,
                    runId(context),
                    stepIndex.incrementAndGet(),
                    AiStepType.TOOL_RESULT,
                    null,
                    tool.name(),
                    tool.permission(),
                    Map.of(),
                    output,
                    result.success() ? "SUCCESS" : "FAILED",
                    result.latencyMs(),
                    result.errorMessage(),
                    LocalDateTime.now()
            );
            steps.add(resultStep);
            observer.onStep(resultStep);
            String text = result.success() ? toJson(output) : result.errorMessage();
            ToolResultBlock block = result.success()
                    ? ToolResultBlock.of(TextBlock.builder().text(text == null ? "" : text).build())
                    : ToolResultBlock.error(text == null ? "Tool execution failed" : text);
            if (param != null && param.getToolUseBlock() != null) {
                block = block.withIdAndName(param.getToolUseBlock().getId(), tool.name());
            }
            return Mono.just(block);
        }
    }

    private Map<String, Object> toolMetadata(AiAgentRunRequest request, AiAgentRunContext context, ToolCallParam param) {
        Map<String, Object> metadata = new LinkedHashMap<>(context == null || context.metadata() == null ? Map.of() : context.metadata());
        metadata.put("agentProfile", request == null ? null : request.agentProfile());
        metadata.put("agentScopeToolCallId", param == null || param.getToolUseBlock() == null ? null : param.getToolUseBlock().getId());
        return metadata;
    }

    private ChatModelBase buildChatModel(AiModelProfile profile, boolean streaming) {
        AiModelProvider modelProvider = requireModelProvider(profile);
        String apiKey = resolveApiKey(profile);
        String modelName = requireText(profile.getModelName(), "AI 模型名不能为空");
        String baseUrl = blankToNull(profile.getBaseUrl());
        return switch (modelProvider) {
            case DASHSCOPE -> {
                DashScopeChatModel.Builder builder = DashScopeChatModel.builder().modelName(modelName).stream(streaming);
                if (apiKey != null) {
                    builder.apiKey(apiKey);
                }
                if (baseUrl != null) {
                    builder.baseUrl(baseUrl);
                }
                yield builder.build();
            }
            case OPENAI, OPENAI_COMPATIBLE -> {
                OpenAIChatModel.Builder builder = OpenAIChatModel.builder().modelName(modelName).stream(streaming);
                if (apiKey != null) {
                    builder.apiKey(apiKey);
                }
                if (baseUrl != null) {
                    builder.baseUrl(baseUrl);
                }
                yield builder.build();
            }
            case ANTHROPIC -> {
                AnthropicChatModel.Builder builder = AnthropicChatModel.builder().modelName(modelName).stream(streaming);
                if (apiKey != null) {
                    builder.apiKey(apiKey);
                }
                if (baseUrl != null) {
                    builder.baseUrl(baseUrl);
                }
                yield builder.build();
            }
            case GEMINI -> {
                GeminiChatModel.Builder builder = GeminiChatModel.builder().modelName(modelName).streamEnabled(streaming);
                if (apiKey != null) {
                    builder.apiKey(apiKey);
                }
                yield builder.build();
            }
            case OLLAMA -> {
                OllamaChatModel.Builder builder = OllamaChatModel.builder().modelName(modelName);
                if (baseUrl != null) {
                    builder.baseUrl(baseUrl);
                }
                yield builder.build();
            }
        };
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
            case DASHSCOPE -> {
                DashScopeTextEmbedding.Builder builder = DashScopeTextEmbedding.builder()
                        .modelName(modelName)
                        .dimensions(dimensions);
                if (apiKey != null) {
                    builder.apiKey(apiKey);
                }
                if (baseUrl != null) {
                    builder.baseUrl(baseUrl);
                }
                yield builder.build();
            }
            case OPENAI, OPENAI_COMPATIBLE -> {
                OpenAITextEmbedding.Builder builder = OpenAITextEmbedding.builder()
                        .modelName(modelName)
                        .dimensions(dimensions);
                if (apiKey != null) {
                    builder.apiKey(apiKey);
                }
                if (baseUrl != null) {
                    builder.baseUrl(baseUrl);
                }
                yield builder.build();
            }
            case OLLAMA -> {
                OllamaTextEmbedding.Builder builder = OllamaTextEmbedding.builder()
                        .modelName(modelName)
                        .dimensions(dimensions);
                if (baseUrl != null) {
                    builder.baseUrl(baseUrl);
                }
                yield builder.build();
            }
            case ANTHROPIC, GEMINI ->
                    throw new UnsupportedOperationException("AgentScope 当前 Embedding 适配未支持模型供应商: " + modelProvider);
        };
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

    private String runId(AiAgentRunContext context) {
        return context == null || context.metadata() == null ? null : stringValue(context.metadata().get("agentRunId"));
    }

    private final class ProgressHook implements Hook {
        private final AiAgentRunObserver observer;

        private ProgressHook(AiAgentRunObserver observer) {
            this.observer = observer;
        }

        @Override
        public <T extends HookEvent> Mono<T> onEvent(T event) {
            if (event instanceof ReasoningChunkEvent reasoningChunkEvent) {
                observer.onTextDelta(
                        textValue(reasoningChunkEvent.getIncrementalChunk()),
                        textValue(reasoningChunkEvent.getAccumulated())
                );
            } else if (event instanceof SummaryChunkEvent summaryChunkEvent) {
                observer.onTextDelta(
                        textValue(summaryChunkEvent.getIncrementalChunk()),
                        textValue(summaryChunkEvent.getAccumulated())
                );
            } else if (event instanceof PostCallEvent postCallEvent) {
                String text = textValue(postCallEvent.getFinalMessage());
                observer.onTextDelta(text, text);
            }
            return Mono.just(event);
        }
    }

    private String textValue(Msg message) {
        return message == null ? "" : message.getTextContent();
    }

    private List<Msg> toMessages(List<AiMessage> messages) {
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

    private MsgRole toRole(String role) {
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
    private Map<String, Object> structuredData(Msg message) {
        if (message == null || !message.hasStructuredData()) {
            throw new IllegalStateException("AI structured 输出缺少结构化数据");
        }
        Map<String, Object> data = message.getStructuredData(true);
        if (data == null || data.isEmpty()) {
            throw new IllegalStateException("AI structured 输出为空");
        }
        return data;
    }

    private JsonNode structuredOutputSchema(Map<String, Object> outputSchema) {
        try {
            return OBJECT_MAPPER.valueToTree(
                    outputSchema == null || outputSchema.isEmpty()
                            ? Map.of("type", "object")
                            : outputSchema
            );
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("AI structured 输出 Schema 无法转换: " + exception.getMessage(), exception);
        }
    }

    private StructuredOutputReminder structuredOutputReminder(Map<String, Object> options) {
        String reminder = stringOption(options, "structuredOutputReminder");
        if (reminder == null) {
            return StructuredOutputReminder.TOOL_CHOICE;
        }
        return switch (reminder.trim().toUpperCase()) {
            case "TOOL_CHOICE" -> StructuredOutputReminder.TOOL_CHOICE;
            case "PROMPT" -> StructuredOutputReminder.PROMPT;
            default -> throw new IllegalArgumentException("Unsupported structuredOutputReminder: " + reminder);
        };
    }

    private String text(ChatResponse response) {
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

    private ChatUsage lastUsage(List<ChatResponse> responses) {
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

    private AiUsage toUsage(ChatUsage usage) {
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

    private AiModelProvider requireModelProvider(AiModelProfile profile) {
        if (profile.getModelProvider() == null) {
            throw new IllegalArgumentException("AI 模型供应商不能为空: " + profile.getId());
        }
        return profile.getModelProvider();
    }

    private Map<String, Object> mergedOptions(Map<String, Object> left, Map<String, Object> right) {
        Map<String, Object> merged = new LinkedHashMap<>();
        if (left != null) {
            merged.putAll(left);
        }
        if (right != null) {
            merged.putAll(right);
        }
        return merged;
    }

    private Duration modelCallTimeout(AiModelProfile profile, Map<String, Object> requestOptions) {
        Integer timeoutSeconds = intOption(mergedOptions(profile.getDefaultOptions(), requestOptions), "timeoutSeconds");
        return timeoutSeconds == null || timeoutSeconds <= 0 ? null : Duration.ofSeconds(timeoutSeconds);
    }

    private Duration outerAgentTimeout(AiModelProfile profile, Map<String, Object> requestOptions, AiAgentRunContext context) {
        return disableOuterTimeout(context) ? null : modelCallTimeout(profile, requestOptions);
    }

    private boolean disableOuterTimeout(AiAgentRunContext context) {
        if (context == null || context.metadata() == null) {
            return false;
        }
        return Boolean.TRUE.equals(context.metadata().get(DISABLE_OUTER_TIMEOUT_METADATA_KEY));
    }

    private <T> T block(reactor.core.publisher.Mono<T> mono, Duration timeout) {
        return timeout == null ? mono.block() : mono.block(timeout);
    }

    private String requireText(String value, String message) {
        String text = blankToNull(value);
        if (text == null) {
            throw new IllegalArgumentException(message);
        }
        return text;
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private String toJson(Object value) {
        try {
            return OBJECT_MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            return "{}";
        }
    }

    private String stringOption(Map<String, Object> options, String key) {
        Object value = options.get(key);
        return value == null ? null : String.valueOf(value);
    }

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private Double doubleOption(Map<String, Object> options, String key) {
        Object value = options.get(key);
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        if (value instanceof String text && !text.isBlank()) {
            return Double.parseDouble(text);
        }
        return null;
    }

    private Integer intOption(Map<String, Object> options, String key) {
        return intOption(options, key, null);
    }

    private Integer intOption(Map<String, Object> options, String key, Integer defaultValue) {
        Object value = options.get(key);
        if (value instanceof Number number) {
            return number.intValue();
        }
        if (value instanceof String text && !text.isBlank()) {
            return Integer.parseInt(text);
        }
        return defaultValue;
    }

    private Long longOption(Map<String, Object> options, String key) {
        Object value = options.get(key);
        if (value instanceof Number number) {
            return number.longValue();
        }
        if (value instanceof String text && !text.isBlank()) {
            return Long.parseLong(text);
        }
        return null;
    }
}
