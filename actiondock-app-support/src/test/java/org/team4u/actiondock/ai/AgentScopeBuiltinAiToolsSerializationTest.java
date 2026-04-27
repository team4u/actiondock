package org.team4u.actiondock.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.team4u.actiondock.ai.agentscope.AgentScopeBuiltinAiTools;
import org.team4u.actiondock.ai.api.AiToolDescriptor;

import static org.assertj.core.api.Assertions.assertThat;

class AgentScopeBuiltinAiToolsSerializationTest {
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void serializesToolMetadataWithoutRuntimeFields() throws Exception {
        AiToolDescriptor tool = AiToolDescriptor.from(AgentScopeBuiltinAiTools.create(key -> "secret").getFirst());

        JsonNode json = objectMapper.readTree(objectMapper.writeValueAsString(tool));

        assertThat(json.get("name").asText()).startsWith("agentscope.");
        assertThat(json.has("description")).isTrue();
        assertThat(json.has("permission")).isTrue();
        assertThat(json.has("inputSchema")).isTrue();
        assertThat(json.has("outputSchema")).isTrue();
        assertThat(json.get("configurable").asBoolean()).isTrue();
        assertThat(json.has("configHelp")).isTrue();
        assertThat(json.has("configExample")).isTrue();
        assertThat(json.has("secretResolver")).isFalse();
        assertThat(json.has("options")).isFalse();
        assertThat(json.has("localName")).isFalse();
    }
}
