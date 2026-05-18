package org.team4u.actiondock.ai;

import io.agentscope.core.skill.SkillBox;
import io.agentscope.core.tool.Toolkit;
import org.junit.jupiter.api.Test;
import org.team4u.actiondock.ai.agentscope.AgentScopeAiProviderClient;
import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.api.AiAgentSkill;
import org.team4u.actiondock.ai.api.AiAgentSkillRegistry;

import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AgentScopeAiProviderClientSkillBoxTest {
    @Test
    void buildSkillBoxRegistersConfiguredAgentSkills() throws Exception {
        AiAgentSkillRegistry skillRegistry = mock(AiAgentSkillRegistry.class);
        when(skillRegistry.requireSkill("skill-a"))
                .thenReturn(new AiAgentSkill("skill-a", "Skill A", "Skill A", "content", Map.of("refs/a.txt", "ref"), "/tmp/skill-a"));
        AgentScopeAiProviderClient client = new AgentScopeAiProviderClient(key -> "secret", skillRegistry);
        AiAgentProfile profile = new AiAgentProfile()
                .setId("agent")
                .setName("Agent")
                .setModelProfileId("model")
                .setSkillIds(List.of("skill-a"));

        SkillBox skillBox = invokeBuildSkillBox(client, profile);

        assertThat(skillBox.getAllSkillIds()).hasSize(1);
        verify(skillRegistry).requireSkill("skill-a");
    }

    private SkillBox invokeBuildSkillBox(AgentScopeAiProviderClient client, AiAgentProfile profile) throws Exception {
        Method method = AgentScopeAiProviderClient.class.getDeclaredMethod("buildSkillBox", AiAgentProfile.class, Toolkit.class);
        method.setAccessible(true);
        return (SkillBox) method.invoke(client, profile, new Toolkit());
    }
}
