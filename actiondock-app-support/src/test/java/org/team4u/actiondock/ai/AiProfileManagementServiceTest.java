package org.team4u.actiondock.ai;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiModelProvider;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.ai.core.AiAgentProfileService;
import org.team4u.actiondock.ai.core.AiModelProfileService;
import org.team4u.actiondock.ai.core.AiToolsetService;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AiProfileManagementServiceTest {
    @Test
    void modelCannotBeDeletedWhenReferencedByAgent() {
        InMemoryAiModelProfileRepository models = new InMemoryAiModelProfileRepository();
        InMemoryAiAgentProfileRepository agents = new InMemoryAiAgentProfileRepository();
        models.save(model("model"));
        agents.save(agent("agent", "model", List.of()));

        AiModelProfileService service = new AiModelProfileService(models, agents);

        assertThatThrownBy(() -> service.delete("model"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("已被 Agent 引用")
                .hasMessageContaining("agent");
    }

    @Test
    void toolsetCannotBeDeletedWhenReferencedByAgent() {
        InMemoryAiToolsetRepository toolsets = new InMemoryAiToolsetRepository();
        InMemoryAiAgentProfileRepository agents = new InMemoryAiAgentProfileRepository();
        toolsets.save(toolset("tools"));
        agents.save(agent("agent", "model", List.of("tools")));

        AiToolsetService service = new AiToolsetService(toolsets, agents);

        assertThatThrownBy(() -> service.delete("tools"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("已被 Agent 引用")
                .hasMessageContaining("agent");
    }

    @Test
    void agentSaveRequiresExistingToolsets() {
        InMemoryAiModelProfileRepository models = new InMemoryAiModelProfileRepository();
        InMemoryAiAgentProfileRepository agents = new InMemoryAiAgentProfileRepository();
        InMemoryAiToolsetRepository toolsets = new InMemoryAiToolsetRepository();
        models.save(model("model"));

        AiAgentProfileService service = new AiAgentProfileService(agents, models, toolsets);

        assertThatThrownBy(() -> service.save(agent("agent", "model", List.of("missing-tools"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("AI 工具集不存在: missing-tools");
    }

    private static AiModelProfile model(String id) {
        return new AiModelProfile()
                .setId(id)
                .setName("Model")
                .setModelProvider(AiModelProvider.OPENAI)
                .setModelName("gpt-test");
    }

    private static AiAgentProfile agent(String id, String modelProfileId, List<String> toolsetIds) {
        return new AiAgentProfile()
                .setId(id)
                .setName("Agent")
                .setModelProfileId(modelProfileId)
                .setToolsetIds(toolsetIds);
    }

    private static AiToolset toolset(String id) {
        return new AiToolset()
                .setId(id)
                .setName("Tools");
    }

    private static final class InMemoryAiModelProfileRepository implements AiModelProfileRepository {
        private final Map<String, AiModelProfile> values = new LinkedHashMap<>();
        public AiModelProfile save(AiModelProfile profile) { values.put(profile.getId(), profile); return profile; }
        public Optional<AiModelProfile> findById(String id) { return Optional.ofNullable(values.get(id)); }
        public List<AiModelProfile> findAll() { return new ArrayList<>(values.values()); }
        public void deleteById(String id) { values.remove(id); }
    }

    private static final class InMemoryAiAgentProfileRepository implements AiAgentProfileRepository {
        private final Map<String, AiAgentProfile> values = new LinkedHashMap<>();
        public AiAgentProfile save(AiAgentProfile profile) { values.put(profile.getId(), profile); return profile; }
        public Optional<AiAgentProfile> findById(String id) { return Optional.ofNullable(values.get(id)); }
        public List<AiAgentProfile> findAll() { return new ArrayList<>(values.values()); }
        public void deleteById(String id) { values.remove(id); }
    }

    private static final class InMemoryAiToolsetRepository implements AiToolsetRepository {
        private final Map<String, AiToolset> values = new LinkedHashMap<>();
        public AiToolset save(AiToolset toolset) { values.put(toolset.getId(), toolset); return toolset; }
        public Optional<AiToolset> findById(String id) { return Optional.ofNullable(values.get(id)); }
        public List<AiToolset> findAll() { return new ArrayList<>(values.values()); }
        public void deleteById(String id) { values.remove(id); }
    }
}
