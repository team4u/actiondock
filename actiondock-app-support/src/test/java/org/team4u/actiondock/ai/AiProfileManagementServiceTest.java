package org.team4u.actiondock.ai;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiAgentSkill;
import org.team4u.actiondock.ai.api.AiAgentSkillRegistry;
import org.team4u.actiondock.ai.api.AiModelProfile;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiModelProvider;
import org.team4u.actiondock.ai.api.AiTool;
import org.team4u.actiondock.ai.api.AiToolExecutionContext;
import org.team4u.actiondock.ai.api.AiToolExecutionResult;
import org.team4u.actiondock.ai.api.AiToolPermission;
import org.team4u.actiondock.ai.api.AiToolRegistry;
import org.team4u.actiondock.ai.api.AiToolset;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.ai.core.AiAgentProfileService;
import org.team4u.actiondock.ai.core.AiModelProfileService;
import org.team4u.actiondock.ai.core.AiToolRegistryImpl;
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

    @Test
    void agentSaveValidatesConfiguredSkills() {
        InMemoryAiModelProfileRepository models = new InMemoryAiModelProfileRepository();
        InMemoryAiAgentProfileRepository agents = new InMemoryAiAgentProfileRepository();
        InMemoryAiToolsetRepository toolsets = new InMemoryAiToolsetRepository();
        models.save(model("model"));
        AiAgentSkillRegistry skillRegistry = org.mockito.Mockito.mock(AiAgentSkillRegistry.class);
        org.mockito.Mockito.when(skillRegistry.requireSkill("skill-a"))
                .thenReturn(new AiAgentSkill("skill-a", "Skill A", "Skill A", "content", Map.of(), "/tmp/skill-a"));
        AiAgentProfileService service = new AiAgentProfileService(agents, models, toolsets, null, skillRegistry);

        service.save(agent("agent", "model", List.of()).setSkillIds(List.of("skill-a")));

        org.mockito.Mockito.verify(skillRegistry).requireSkill("skill-a");
    }

    @Test
    void agentSaveRejectsUnavailableSkill() {
        InMemoryAiModelProfileRepository models = new InMemoryAiModelProfileRepository();
        InMemoryAiAgentProfileRepository agents = new InMemoryAiAgentProfileRepository();
        InMemoryAiToolsetRepository toolsets = new InMemoryAiToolsetRepository();
        models.save(model("model"));
        AiAgentSkillRegistry skillRegistry = org.mockito.Mockito.mock(AiAgentSkillRegistry.class);
        org.mockito.Mockito.when(skillRegistry.requireSkill("missing-skill"))
                .thenThrow(new IllegalArgumentException("Skill 不存在: missing-skill"));
        AiAgentProfileService service = new AiAgentProfileService(agents, models, toolsets, null, skillRegistry);

        assertThatThrownBy(() -> service.save(agent("agent", "model", List.of()).setSkillIds(List.of("missing-skill"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Skill 不存在: missing-skill");
    }

    @Test
    void agentSaveAllowsMergedDirectToolWhenConfigMatchesToolset() {
        InMemoryAiModelProfileRepository models = new InMemoryAiModelProfileRepository();
        InMemoryAiAgentProfileRepository agents = new InMemoryAiAgentProfileRepository();
        InMemoryAiToolsetRepository toolsets = new InMemoryAiToolsetRepository();
        models.save(model("model"));
        toolsets.save(new AiToolset()
                .setId("tools")
                .setName("Tools")
                .setToolNames(List.of("existing-tool"))
                .setToolOptions(Map.of("existing-tool", Map.of("baseDir", "/tmp"))));
        AiToolRegistryImpl toolRegistry = new AiToolRegistryImpl(toolsets, List.of(new TestTool()));

        AiAgentProfileService service = new AiAgentProfileService(agents, models, toolsets, toolRegistry);

        service.save(agent("agent", "model", List.of("tools"))
                .setDirectToolNames(List.of("existing-tool"))
                .setDirectToolOptions(Map.of("existing-tool", Map.of("baseDir", "/tmp"))));
    }

    @Test
    void agentSaveRejectsDirectToolConflictWhenConfigDiffersFromToolset() {
        InMemoryAiModelProfileRepository models = new InMemoryAiModelProfileRepository();
        InMemoryAiAgentProfileRepository agents = new InMemoryAiAgentProfileRepository();
        InMemoryAiToolsetRepository toolsets = new InMemoryAiToolsetRepository();
        models.save(model("model"));
        toolsets.save(new AiToolset()
                .setId("tools")
                .setName("Tools")
                .setToolNames(List.of("existing-tool"))
                .setToolOptions(Map.of("existing-tool", Map.of("baseDir", "/tmp"))));
        AiToolRegistryImpl toolRegistry = new AiToolRegistryImpl(toolsets, List.of(new TestTool()));

        AiAgentProfileService service = new AiAgentProfileService(agents, models, toolsets, toolRegistry);

        assertThatThrownBy(() -> service.save(agent("agent", "model", List.of("tools"))
                .setDirectToolNames(List.of("existing-tool"))
                .setDirectToolOptions(Map.of("existing-tool", Map.of("baseDir", "/srv")))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Agent 工具配置冲突")
                .hasMessageContaining("existing-tool")
                .hasMessageContaining("toolset:tools")
                .hasMessageContaining("direct");
    }

    @Test
    void toolsetSaveRequiresExistingTools() {
        InMemoryAiToolsetRepository toolsets = new InMemoryAiToolsetRepository();

        AiToolsetService service = new AiToolsetService(toolsets, null, new SingleToolRegistry());

        assertThatThrownBy(() -> service.save(new AiToolset()
                .setId("tools")
                .setName("Tools")
                .setToolNames(List.of("missing-tool"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("AI 工具不存在: missing-tool");
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

    private static final class SingleToolRegistry implements AiToolRegistry {
        @Override
        public List<AiTool> listTools(String toolsetId) {
            return List.of(new TestTool());
        }

        @Override
        public List<AiTool> listAgentTools(AiAgentProfile agentProfile) {
            return List.of(new TestTool());
        }

        @Override
        public AiTool getTool(String name) {
            if (!"existing-tool".equals(name)) {
                throw new IllegalArgumentException("AI 工具不存在: " + name);
            }
            return new TestTool();
        }

        @Override
        public AiToolExecutionResult invoke(String toolName, Map<String, Object> input, AiToolExecutionContext context) {
            throw new UnsupportedOperationException();
        }
    }

    private static final class TestTool implements AiTool {
        @Override
        public String name() {
            return "existing-tool";
        }

        @Override
        public String description() {
            return "existing";
        }

        @Override
        public Map<String, Object> inputSchema() {
            return Map.of();
        }

        @Override
        public Map<String, Object> outputSchema() {
            return Map.of();
        }

        @Override
        public AiToolPermission permission() {
            return AiToolPermission.READ_ONLY;
        }

        @Override
        public AiToolExecutionResult invoke(Map<String, Object> input, AiToolExecutionContext context) {
            return AiToolExecutionResult.success(Map.of(), 1L);
        }
    }
}
