package org.team4u.actiondock.ai;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.ai.agentscope.AgentScopeAiProviderClient;
import org.team4u.actiondock.ai.api.AiAgentRunContext;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiModelProvider;
import org.team4u.actiondock.ai.api.AiSecretResolver;
import io.agentscope.core.model.StructuredOutputReminder;

import java.lang.reflect.Method;
import java.time.Duration;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class AgentScopeAiProviderClientTimeoutTest {
    @Test
    void asyncContextDisablesOuterTimeoutButKeepsModelTimeout() throws Exception {
        AgentScopeAiProviderClient client = new AgentScopeAiProviderClient(dummyResolver());
        AiModelProfile profile = baseProfile();
        AiAgentRunContext asyncContext = new AiAgentRunContext(null, null, null, null, Map.of("disableOuterTimeout", true));

        assertThat(invokeDuration(client, "outerAgentTimeout", profile, Map.of("timeoutSeconds", 90), asyncContext))
                .isNull();
        assertThat(invokeDuration(client, "modelCallTimeout", profile, Map.of("timeoutSeconds", 90)))
                .isEqualTo(Duration.ofSeconds(90));
    }

    @Test
    void syncContextKeepsOuterTimeout() throws Exception {
        AgentScopeAiProviderClient client = new AgentScopeAiProviderClient(dummyResolver());
        AiModelProfile profile = baseProfile();
        AiAgentRunContext syncContext = AiAgentRunContext.adminTest();

        assertThat(invokeDuration(client, "outerAgentTimeout", profile, Map.of("timeoutSeconds", 90), syncContext))
                .isEqualTo(Duration.ofSeconds(90));
    }

    @Test
    void structuredOutputReminderDefaultsToToolChoiceAndSupportsPrompt() throws Exception {
        AgentScopeAiProviderClient client = new AgentScopeAiProviderClient(dummyResolver());

        assertThat(invokeStructuredOutputReminder(client, Map.of()))
                .isEqualTo(StructuredOutputReminder.TOOL_CHOICE);
        assertThat(invokeStructuredOutputReminder(client, Map.of("structuredOutputReminder", "PROMPT")))
                .isEqualTo(StructuredOutputReminder.PROMPT);
    }

    private AiModelProfile baseProfile() {
        return new AiModelProfile()
                .setId("model")
                .setName("Model")
                .setModelProvider(AiModelProvider.OPENAI)
                .setModelName("gpt-test");
    }

    private AiSecretResolver dummyResolver() {
        return key -> null;
    }

    private Duration invokeDuration(AgentScopeAiProviderClient client,
                                    String methodName,
                                    AiModelProfile profile,
                                    Map<String, Object> requestOptions,
                                    AiAgentRunContext context) throws Exception {
        Method method = AgentScopeAiProviderClient.class.getDeclaredMethod(methodName, AiModelProfile.class, Map.class, AiAgentRunContext.class);
        method.setAccessible(true);
        return (Duration) method.invoke(client, profile, requestOptions, context);
    }

    private Duration invokeDuration(AgentScopeAiProviderClient client,
                                    String methodName,
                                    AiModelProfile profile,
                                    Map<String, Object> requestOptions) throws Exception {
        Method method = AgentScopeAiProviderClient.class.getDeclaredMethod(methodName, AiModelProfile.class, Map.class);
        method.setAccessible(true);
        return (Duration) method.invoke(client, profile, requestOptions);
    }

    private StructuredOutputReminder invokeStructuredOutputReminder(AgentScopeAiProviderClient client,
                                                                   Map<String, Object> options) throws Exception {
        Method method = AgentScopeAiProviderClient.class.getDeclaredMethod("structuredOutputReminder", Map.class);
        method.setAccessible(true);
        return (StructuredOutputReminder) method.invoke(client, options);
    }
}
