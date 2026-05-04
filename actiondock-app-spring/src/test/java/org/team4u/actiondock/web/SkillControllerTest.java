package org.team4u.actiondock.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.actiondock.RuntimeApplication;
import org.team4u.actiondock.domain.model.SkillInstallation;
import org.team4u.actiondock.skill.SkillService;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        classes = RuntimeApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        properties = {
                "spring.config.name=does-not-exist",
                "server.port=0",
                "spring.datasource.url=jdbc:h2:mem:skill-controller;DB_CLOSE_DELAY=-1",
                "spring.datasource.driver-class-name=org.h2.Driver",
                "spring.datasource.username=sa",
                "spring.jpa.hibernate.ddl-auto=create-drop",
                "spring.jpa.open-in-view=false",
                "spring.h2.console.enabled=false",
                "app.execution.async-pool-size=1"
        }
)
@AutoConfigureMockMvc
class SkillControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private SkillService skillService;

    @Test
    void archiveReturnsBinaryDownload() throws Exception {
        when(skillService.exportInstallationArchive("skill-1"))
                .thenReturn(new SkillService.SkillArchive("skill-1.zip", "zip-content".getBytes()));

        mockMvc.perform(get("/api/skills/skill-1/archive"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"skill-1.zip\""))
                .andExpect(content().bytes("zip-content".getBytes()));
    }

    @Test
    void draftInstallArchiveDelegatesToSkillService() throws Exception {
        when(skillService.installArchive(eq("target-1"), eq("repo-1"), eq("draft.zip"), any()))
                .thenReturn(new SkillInstallation().setInstallationId("skill@target").setSkillId("skill"));

        mockMvc.perform(multipart("/api/skills/draft-install-archive")
                        .file(new MockMultipartFile("archive", "draft.zip", MediaType.APPLICATION_OCTET_STREAM_VALUE, "zip".getBytes()))
                        .param("targetId", "target-1")
                        .param("repositoryId", "repo-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.installationId").value("skill@target"))
                .andExpect(jsonPath("$.data.skillId").value("skill"));

        verify(skillService).installArchive(eq("target-1"), eq("repo-1"), eq("draft.zip"), any());
    }
}
