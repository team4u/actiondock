package org.team4u.actiondock.ai.core;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.team4u.actiondock.ai.api.*;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * AiGatewayImpl 的单元测试。
 * <p>
 * 覆盖聊天、结构化输出、向量嵌入三种能力的成功路径与异常路径，
 * 以及模型 Profile 校验、审计日志记录等横切关注点。
 *
 * @author jay.wu
 */
class AiGatewayImplTest {

    private AiModelProfileService modelProfileService;
    private AiProviderClient providerClient;
    private AiCallLogRepository callLogRepository;
    private AiGatewayImpl gateway;

    private AiModelProfile chatProfile;

    @BeforeEach
    void setUp() {
        modelProfileService = mock(AiModelProfileService.class);
        providerClient = mock(AiProviderClient.class);
        callLogRepository = mock(AiCallLogRepository.class);
        gateway = new AiGatewayImpl(modelProfileService, providerClient, callLogRepository);

        chatProfile = new AiModelProfile()
                .setId("test-chat-profile")
                .setModelName("gpt-4")
                .setProvider(AiProvider.AGENTSCOPE)
                .setCapabilities(Set.of(AiCapability.CHAT, AiCapability.STRUCTURED_OUTPUT))
                .setEnabled(true);

        when(callLogRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
    }

    // ==================== chat 成功路径 ====================

    /**
     * 聊天调用成功时应返回提供者响应并记录审计日志。
     */
    @Test
    void shouldReturnChatResponseAndAuditOnSuccess() {
        when(modelProfileService.get("test-chat-profile")).thenReturn(chatProfile);
        AiChatResponse expected = new AiChatResponse("你好", new AiUsage(10, 20, 30), Map.of());
        when(providerClient.chat(eq(chatProfile), any(), any())).thenReturn(expected);

        AiChatRequest request = new AiChatRequest("test-chat-profile",
                List.of(new AiMessage("user", "hello")), null);
        AiCallContext context = AiCallContext.adminTest();

        AiChatResponse response = gateway.chat(request, context);

        assertThat(response).isSameAs(expected);
        assertThat(response.data()).isEqualTo("你好");

        verify(callLogRepository).save(assertArg(log -> {
            assertThat(log.getAction()).isEqualTo(AiCallAction.CHAT);
            assertThat(log.getStatus()).isEqualTo(AiStepStatus.SUCCESS);
            assertThat(log.getModelProfile()).isEqualTo("test-chat-profile");
            assertThat(log.getModel()).isEqualTo("gpt-4");
            assertThat(log.getInputTokens()).isEqualTo(10);
            assertThat(log.getOutputTokens()).isEqualTo(20);
            assertThat(log.getTotalTokens()).isEqualTo(30);
            assertThat(log.getLatencyMs()).isNotNull().isGreaterThanOrEqualTo(0);
            assertThat(log.getErrorType()).isNull();
            assertThat(log.getErrorMessage()).isNull();
            assertThat(log.getPromptHash()).isNotBlank();
            assertThat(log.getRequestSummary()).containsEntry("messageCount", 1);
            assertThat(log.getResponseSummary()).containsEntry("dataLength", 2);
        }));
    }

    /**
     * 聊天响应 data 为 null 时，审计日志中 dataLength 应为 0。
     */
    @Test
    void shouldHandleNullDataInChatResponse() {
        when(modelProfileService.get("test-chat-profile")).thenReturn(chatProfile);
        AiChatResponse expected = new AiChatResponse(null, AiUsage.empty(), Map.of());
        when(providerClient.chat(eq(chatProfile), any(), any())).thenReturn(expected);

        AiChatRequest request = new AiChatRequest("test-chat-profile",
                List.of(new AiMessage("user", "hello")), null);

        AiChatResponse response = gateway.chat(request, AiCallContext.adminTest());

        assertThat(response.data()).isNull();
        verify(callLogRepository).save(assertArg(log ->
                assertThat(log.getResponseSummary()).containsEntry("dataLength", 0)
        ));
    }

    /**
     * 聊天调用上下文为 null 时，审计日志中上下文字段应为 null。
     */
    @Test
    void shouldHandleNullContextInChat() {
        when(modelProfileService.get("test-chat-profile")).thenReturn(chatProfile);
        AiChatResponse expected = new AiChatResponse("hi", AiUsage.empty(), Map.of());
        when(providerClient.chat(eq(chatProfile), any(), any())).thenReturn(expected);

        AiChatRequest request = new AiChatRequest("test-chat-profile",
                List.of(new AiMessage("user", "hello")), null);

        gateway.chat(request, null);

        verify(callLogRepository).save(assertArg(log -> {
            assertThat(log.getExecutionId()).isNull();
            assertThat(log.getScriptId()).isNull();
            assertThat(log.getPluginId()).isNull();
            assertThat(log.getAgentRunId()).isNull();
            assertThat(log.getAgentStepId()).isNull();
            assertThat(log.getCallerType()).isNull();
        }));
    }

    // ==================== structured 成功路径 ====================

    /**
     * 结构化输出调用成功时应返回提供者响应并记录审计日志。
     */
    @Test
    void shouldReturnStructuredResponseAndAuditOnSuccess() {
        when(modelProfileService.get("test-chat-profile")).thenReturn(chatProfile);
        Map<String, Object> data = Map.of("name", "test", "age", 25);
        AiStructuredResponse expected = new AiStructuredResponse(data,
                new AiUsage(5, 10, 15), Map.of());
        when(providerClient.structured(eq(chatProfile), any(), any())).thenReturn(expected);

        AiStructuredRequest request = new AiStructuredRequest("test-chat-profile",
                List.of(new AiMessage("user", "extract")),
                Map.of("type", "object"), null);

        AiStructuredResponse response = gateway.structured(request, AiCallContext.adminTest());

        assertThat(response).isSameAs(expected);
        assertThat(response.data()).hasSize(2);

        verify(callLogRepository).save(assertArg(log -> {
            assertThat(log.getAction()).isEqualTo(AiCallAction.STRUCTURED);
            assertThat(log.getStatus()).isEqualTo(AiStepStatus.SUCCESS);
            assertThat(log.getInputTokens()).isEqualTo(5);
            assertThat(log.getResponseSummary()).containsEntry("fieldCount", 2);
        }));
    }

    /**
     * 结构化输出响应 data 为 null 时，审计日志中 fieldCount 应为 0。
     */
    @Test
    void shouldHandleNullDataInStructuredResponse() {
        when(modelProfileService.get("test-chat-profile")).thenReturn(chatProfile);
        AiStructuredResponse expected = new AiStructuredResponse(null, AiUsage.empty(), Map.of());
        when(providerClient.structured(eq(chatProfile), any(), any())).thenReturn(expected);

        AiStructuredRequest request = new AiStructuredRequest("test-chat-profile",
                List.of(new AiMessage("user", "test")), null, null);

        gateway.structured(request, AiCallContext.adminTest());

        verify(callLogRepository).save(assertArg(log ->
                assertThat(log.getResponseSummary()).containsEntry("fieldCount", 0)
        ));
    }

    // ==================== embed 成功路径 ====================

    /**
     * 向量嵌入调用成功时应返回提供者响应并记录审计日志。
     */
    @Test
    void shouldReturnEmbedResponseAndAuditOnSuccess() {
        AiModelProfile embedProfile = new AiModelProfile()
                .setId("test-embed-profile")
                .setModelName("text-embedding-ada-002")
                .setProvider(AiProvider.AGENTSCOPE)
                .setCapabilities(Set.of(AiCapability.EMBEDDING))
                .setEnabled(true);

        when(modelProfileService.get("test-embed-profile")).thenReturn(embedProfile);
        List<List<Double>> embeddings = List.of(List.of(0.1, 0.2, 0.3));
        AiEmbeddingResponse expected = new AiEmbeddingResponse(embeddings,
                new AiUsage(3, 0, 3), Map.of());
        when(providerClient.embed(eq(embedProfile), any(), any())).thenReturn(expected);

        AiEmbeddingRequest request = new AiEmbeddingRequest("test-embed-profile",
                List.of("hello world"), null);

        AiEmbeddingResponse response = gateway.embed(request, AiCallContext.adminTest());

        assertThat(response).isSameAs(expected);
        assertThat(response.data()).hasSize(1);

        verify(callLogRepository).save(assertArg(log -> {
            assertThat(log.getAction()).isEqualTo(AiCallAction.EMBED);
            assertThat(log.getStatus()).isEqualTo(AiStepStatus.SUCCESS);
            assertThat(log.getModel()).isEqualTo("text-embedding-ada-002");
            assertThat(log.getRequestSummary()).containsEntry("inputCount", 1);
            assertThat(log.getResponseSummary()).containsEntry("embeddingCount", 1);
        }));
    }

    /**
     * 嵌入请求 input 为 null 时，审计日志中 inputCount 应为 0。
     */
    @Test
    void shouldHandleNullInputInEmbedRequest() {
        AiModelProfile embedProfile = new AiModelProfile()
                .setId("test-embed-profile")
                .setModelName("embed-model")
                .setCapabilities(Set.of(AiCapability.EMBEDDING))
                .setEnabled(true);

        when(modelProfileService.get("test-embed-profile")).thenReturn(embedProfile);
        AiEmbeddingResponse expected = new AiEmbeddingResponse(null, AiUsage.empty(), Map.of());
        when(providerClient.embed(eq(embedProfile), any(), any())).thenReturn(expected);

        AiEmbeddingRequest request = new AiEmbeddingRequest("test-embed-profile", null, null);

        gateway.embed(request, AiCallContext.adminTest());

        verify(callLogRepository).save(assertArg(log ->
                assertThat(log.getRequestSummary()).containsEntry("inputCount", 0)
        ));
    }

    // ==================== Profile 校验异常 ====================

    /**
     * 请求中 modelProfile 为 null 时应抛出 IllegalArgumentException。
     */
    @Test
    void shouldThrowWhenChatRequestProfileIsNull() {
        AiChatRequest request = new AiChatRequest(null, null, null);

        assertThatThrownBy(() -> gateway.chat(request, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 模型 Profile 不能为空");

        verifyNoInteractions(providerClient);
        verifyNoInteractions(callLogRepository);
    }

    /**
     * 请求中 modelProfile 为空白字符串时应抛出 IllegalArgumentException。
     */
    @Test
    void shouldThrowWhenChatRequestProfileIsBlank() {
        AiChatRequest request = new AiChatRequest("  ", null, null);

        assertThatThrownBy(() -> gateway.chat(request, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 模型 Profile 不能为空");
    }

    /**
     * 结构化请求中 modelProfile 为 null 时应抛出 IllegalArgumentException。
     */
    @Test
    void shouldThrowWhenStructuredRequestProfileIsNull() {
        AiStructuredRequest request = new AiStructuredRequest(null, null, null, null);

        assertThatThrownBy(() -> gateway.structured(request, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 模型 Profile 不能为空");
    }

    /**
     * 嵌入请求中 modelProfile 为 null 时应抛出 IllegalArgumentException。
     */
    @Test
    void shouldThrowWhenEmbedRequestProfileIsNull() {
        AiEmbeddingRequest request = new AiEmbeddingRequest(null, null, null);

        assertThatThrownBy(() -> gateway.embed(request, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 模型 Profile 不能为空");
    }

    /**
     * 请求本身为 null 时应抛出 IllegalArgumentException（因为取不到 modelProfile）。
     */
    @Test
    void shouldThrowWhenChatRequestIsNull() {
        assertThatThrownBy(() -> gateway.chat(null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 模型 Profile 不能为空");
    }

    /**
     * 结构化请求为 null 时应抛出 IllegalArgumentException。
     */
    @Test
    void shouldThrowWhenStructuredRequestIsNull() {
        assertThatThrownBy(() -> gateway.structured(null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 模型 Profile 不能为空");
    }

    /**
     * 嵌入请求为 null 时应抛出 IllegalArgumentException。
     */
    @Test
    void shouldThrowWhenEmbedRequestIsNull() {
        assertThatThrownBy(() -> gateway.embed(null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 模型 Profile 不能为空");
    }

    /**
     * Profile 已禁用时应抛出 IllegalArgumentException。
     */
    @Test
    void shouldThrowWhenProfileIsDisabled() {
        AiModelProfile disabledProfile = new AiModelProfile()
                .setId("disabled-profile")
                .setCapabilities(Set.of(AiCapability.CHAT))
                .setEnabled(false);
        when(modelProfileService.get("disabled-profile")).thenReturn(disabledProfile);

        AiChatRequest request = new AiChatRequest("disabled-profile",
                List.of(new AiMessage("user", "hi")), null);

        assertThatThrownBy(() -> gateway.chat(request, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 模型 Profile 已禁用: disabled-profile");
    }

    /**
     * Profile 不具备所需能力时应抛出 IllegalArgumentException。
     */
    @Test
    void shouldThrowWhenProfileLacksCapability() {
        AiModelProfile embedOnlyProfile = new AiModelProfile()
                .setId("embed-only")
                .setCapabilities(Set.of(AiCapability.EMBEDDING))
                .setEnabled(true);
        when(modelProfileService.get("embed-only")).thenReturn(embedOnlyProfile);

        AiChatRequest request = new AiChatRequest("embed-only",
                List.of(new AiMessage("user", "hi")), null);

        assertThatThrownBy(() -> gateway.chat(request, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("AI 模型 Profile 不支持能力 CHAT: embed-only");
    }

    // ==================== 提供者调用异常 ====================

    /**
     * 提供者聊天调用抛出 RuntimeException 时应记录失败审计日志并重新抛出异常。
     */
    @Test
    void shouldAuditAndRethrowWhenProviderChatFails() {
        when(modelProfileService.get("test-chat-profile")).thenReturn(chatProfile);
        when(providerClient.chat(eq(chatProfile), any(), any()))
                .thenThrow(new RuntimeException("上游服务不可用"));

        AiChatRequest request = new AiChatRequest("test-chat-profile",
                List.of(new AiMessage("user", "hello")), null);

        assertThatThrownBy(() -> gateway.chat(request, AiCallContext.adminTest()))
                .isInstanceOf(RuntimeException.class)
                .hasMessage("上游服务不可用");

        verify(callLogRepository).save(assertArg(log -> {
            assertThat(log.getStatus()).isEqualTo(AiStepStatus.FAILED);
            assertThat(log.getErrorType()).isEqualTo(RuntimeException.class.getName());
            assertThat(log.getErrorMessage()).isEqualTo("上游服务不可用");
            assertThat(log.getInputTokens()).isEqualTo(0);
            assertThat(log.getOutputTokens()).isEqualTo(0);
            assertThat(log.getTotalTokens()).isEqualTo(0);
            assertThat(log.getResponseSummary()).isEmpty();
        }));
    }

    /**
     * 提供者结构化调用抛出异常时应记录失败审计日志并重新抛出。
     */
    @Test
    void shouldAuditAndRethrowWhenProviderStructuredFails() {
        when(modelProfileService.get("test-chat-profile")).thenReturn(chatProfile);
        when(providerClient.structured(eq(chatProfile), any(), any()))
                .thenThrow(new IllegalStateException("Schema 解析失败"));

        AiStructuredRequest request = new AiStructuredRequest("test-chat-profile",
                List.of(new AiMessage("user", "test")), null, null);

        assertThatThrownBy(() -> gateway.structured(request, AiCallContext.adminTest()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Schema 解析失败");

        verify(callLogRepository).save(assertArg(log -> {
            assertThat(log.getStatus()).isEqualTo(AiStepStatus.FAILED);
            assertThat(log.getErrorType()).isEqualTo(IllegalStateException.class.getName());
            assertThat(log.getErrorMessage()).isEqualTo("Schema 解析失败");
        }));
    }

    /**
     * 提供者嵌入调用抛出异常时应记录失败审计日志并重新抛出。
     */
    @Test
    void shouldAuditAndRethrowWhenProviderEmbedFails() {
        AiModelProfile embedProfile = new AiModelProfile()
                .setId("test-embed-profile")
                .setCapabilities(Set.of(AiCapability.EMBEDDING))
                .setEnabled(true);
        when(modelProfileService.get("test-embed-profile")).thenReturn(embedProfile);
        when(providerClient.embed(eq(embedProfile), any(), any()))
                .thenThrow(new RuntimeException("嵌入服务超时"));

        AiEmbeddingRequest request = new AiEmbeddingRequest("test-embed-profile",
                List.of("text"), null);

        assertThatThrownBy(() -> gateway.embed(request, AiCallContext.adminTest()))
                .isInstanceOf(RuntimeException.class)
                .hasMessage("嵌入服务超时");

        verify(callLogRepository).save(assertArg(log -> {
            assertThat(log.getStatus()).isEqualTo(AiStepStatus.FAILED);
            assertThat(log.getErrorMessage()).isEqualTo("嵌入服务超时");
        }));
    }

    // ==================== 审计日志上下文字段映射 ====================

    /**
     * 审计日志应正确映射调用上下文中的所有字段。
     */
    @Test
    void shouldMapAllContextFieldsToAuditLog() {
        when(modelProfileService.get("test-chat-profile")).thenReturn(chatProfile);
        when(providerClient.chat(eq(chatProfile), any(), any()))
                .thenReturn(new AiChatResponse("ok", AiUsage.empty(), Map.of()));

        AiCallContext context = new AiCallContext(
                AiCallerType.ADMIN_TEST, "script-1", "exec-1",
                "plugin-1", "run-1", "step-1", "user-1", Map.of());

        AiChatRequest request = new AiChatRequest("test-chat-profile",
                List.of(new AiMessage("user", "hi")), null);

        gateway.chat(request, context);

        verify(callLogRepository).save(assertArg(log -> {
            assertThat(log.getExecutionId()).isEqualTo("exec-1");
            assertThat(log.getScriptId()).isEqualTo("script-1");
            assertThat(log.getPluginId()).isEqualTo("plugin-1");
            assertThat(log.getAgentRunId()).isEqualTo("run-1");
            assertThat(log.getAgentStepId()).isEqualTo("step-1");
            assertThat(log.getCallerType()).isEqualTo(AiCallerType.ADMIN_TEST);
        }));
    }

    /**
     * 审计日志的 id 应为非空 UUID，createdAt 应为当前时间。
     */
    @Test
    void shouldGenerateIdAndTimestampInAuditLog() {
        when(modelProfileService.get("test-chat-profile")).thenReturn(chatProfile);
        when(providerClient.chat(eq(chatProfile), any(), any()))
                .thenReturn(new AiChatResponse("ok", AiUsage.empty(), Map.of()));

        AiChatRequest request = new AiChatRequest("test-chat-profile",
                List.of(new AiMessage("user", "hi")), null);

        gateway.chat(request, AiCallContext.adminTest());

        verify(callLogRepository).save(assertArg(log -> {
            assertThat(log.getId()).isNotBlank();
            assertThat(log.getCreatedAt()).isNotNull();
        }));
    }

    /**
     * 聊天请求 messages 为 null 时，审计日志中 messageCount 和 characters 应为 0。
     */
    @Test
    void shouldHandleNullMessagesInChatRequest() {
        when(modelProfileService.get("test-chat-profile")).thenReturn(chatProfile);
        when(providerClient.chat(eq(chatProfile), any(), any()))
                .thenReturn(new AiChatResponse("ok", AiUsage.empty(), Map.of()));

        AiChatRequest request = new AiChatRequest("test-chat-profile", null, null);

        gateway.chat(request, null);

        verify(callLogRepository).save(assertArg(log -> {
            assertThat(log.getRequestSummary()).containsEntry("messageCount", 0);
            assertThat(log.getRequestSummary()).containsEntry("characters", 0);
        }));
    }

    /**
     * 嵌入响应 data 为 null 时，审计日志中 embeddingCount 应为 0。
     */
    @Test
    void shouldHandleNullDataInEmbedResponse() {
        AiModelProfile embedProfile = new AiModelProfile()
                .setId("test-embed-profile")
                .setCapabilities(Set.of(AiCapability.EMBEDDING))
                .setEnabled(true);
        when(modelProfileService.get("test-embed-profile")).thenReturn(embedProfile);

        AiEmbeddingResponse expected = new AiEmbeddingResponse(null, AiUsage.empty(), Map.of());
        when(providerClient.embed(eq(embedProfile), any(), any())).thenReturn(expected);

        AiEmbeddingRequest request = new AiEmbeddingRequest("test-embed-profile",
                List.of("hello"), null);

        gateway.embed(request, AiCallContext.adminTest());

        verify(callLogRepository).save(assertArg(log ->
                assertThat(log.getResponseSummary()).containsEntry("embeddingCount", 0)
        ));
    }
}
