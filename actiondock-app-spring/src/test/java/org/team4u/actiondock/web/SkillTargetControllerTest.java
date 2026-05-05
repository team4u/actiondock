package org.team4u.actiondock.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.actiondock.RuntimeApplication;
import org.team4u.actiondock.skill.SkillTargetService;
import org.team4u.actiondock.skill.SkillTypes;

import java.util.List;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        classes = RuntimeApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        properties = {
                "spring.config.name=does-not-exist",
                "server.port=0",
                "spring.datasource.url=jdbc:h2:mem:skill-target-controller;DB_CLOSE_DELAY=-1",
                "spring.datasource.driver-class-name=org.h2.Driver",
                "spring.datasource.username=sa",
                "spring.jpa.hibernate.ddl-auto=create-drop",
                "spring.jpa.open-in-view=false",
                "spring.h2.console.enabled=false",
                "app.execution.async-pool-size=1"
        }
)
@AutoConfigureMockMvc
class SkillTargetControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private SkillTargetService skillTargetService;

    @Test
    void syncInstallationsDelegatesToSkillTargetService() throws Exception {
        when(skillTargetService.syncSkillsToTarget(eq("target-1"), eq(List.of("skill-a", "skill-b"))))
                .thenReturn(new SkillTypes.SkillSyncResponse(
                        "target-1",
                        List.of(
                                new SkillTypes.SkillSyncResult("skill-a", "target-1", "SUCCESS", "Skill 已同步", null)
                        )
                ));

        mockMvc.perform(post("/api/skill-targets/target-1/sync-installations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"skillIds":["skill-a","skill-b"]}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.targetId").value("target-1"))
                .andExpect(jsonPath("$.data.results[0].skillId").value("skill-a"))
                .andExpect(jsonPath("$.data.results[0].status").value("SUCCESS"));

        verify(skillTargetService).syncSkillsToTarget(eq("target-1"), eq(List.of("skill-a", "skill-b")));
    }
}
