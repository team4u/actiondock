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
import org.team4u.actiondock.skill.GithubSkillCollectionService;
import org.team4u.actiondock.skill.SkillService;
import org.team4u.actiondock.skill.SkillTypes;

import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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

    @MockBean
    private GithubSkillCollectionService githubSkillCollectionService;

    @Test
    void archiveReturnsBinaryDownload() throws Exception {
        when(skillService.exportSkillArchive("skill-1"))
                .thenReturn(new SkillTypes.SkillArchive("skill-1.zip", "zip-content".getBytes()));

        mockMvc.perform(get("/api/skills/skill-1/archive"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"skill-1.zip\""))
                .andExpect(content().bytes("zip-content".getBytes()));
    }

    @Test
    void installArchiveDelegatesToSkillService() throws Exception {
        when(skillService.installArchive(eq(List.of("target-1", "target-2")), eq("repo-1"), eq("skill.zip"), any()))
                .thenReturn(new SkillTypes.SkillListItem(
                        "skill",
                        "repo-1",
                        "1.0.0",
                        "digest",
                        "Skill",
                        "desc",
                        2,
                        0,
                        List.of(
                                new SkillTypes.SkillDeploymentView("target-1", "/targets/one", "/targets/one/skill", true, LocalDateTime.now(), LocalDateTime.now()),
                                new SkillTypes.SkillDeploymentView("target-2", "/targets/two", "/targets/two/skill", true, LocalDateTime.now(), LocalDateTime.now())
                        ),
                        LocalDateTime.now(),
                        LocalDateTime.now()
                ));

        mockMvc.perform(multipart("/api/skills/install-archive")
                        .file(new MockMultipartFile("archive", "skill.zip", MediaType.APPLICATION_OCTET_STREAM_VALUE, "zip".getBytes()))
                        .param("targetIds", "target-1", "target-2")
                        .param("repositoryId", "repo-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.skillId").value("skill"))
                .andExpect(jsonPath("$.data.targets[0].targetId").value("target-1"));

        verify(skillService).installArchive(eq(List.of("target-1", "target-2")), eq("repo-1"), eq("skill.zip"), any());
    }

    @Test
    void scanGithubCollectionDelegatesToService() throws Exception {
        when(githubSkillCollectionService.scan("https://github.com/acme/skills"))
                .thenReturn(new GithubSkillCollectionService.GithubSkillScanResponse(
                        "https://github.com/acme/skills",
                        "acme",
                        "skills",
                        "main",
                        "skills",
                        List.of(new GithubSkillCollectionService.GithubSkillScanItem(
                                "skill-a",
                                "Skill A",
                                "1.0.0",
                                "desc",
                                "skills/skill-a",
                                "digest",
                                List.of()
                        ))
                ));

        mockMvc.perform(post("/api/skills/github/scan")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"url\":\"https://github.com/acme/skills\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.owner").value("acme"))
                .andExpect(jsonPath("$.data.skills[0].path").value("skills/skill-a"));

        verify(githubSkillCollectionService).scan("https://github.com/acme/skills");
    }

    @Test
    void installGithubCollectionDelegatesToService() throws Exception {
        when(githubSkillCollectionService.install(
                eq("https://github.com/acme/skills"),
                eq(List.of("target-1")),
                eq(List.of("skills/skill-a"))
        )).thenReturn(new GithubSkillCollectionService.GithubSkillInstallResponse(
                "https://github.com/acme/skills",
                "acme",
                "skills",
                "main",
                "skills",
                List.of(new GithubSkillCollectionService.GithubSkillInstallResult(
                        "skills/skill-a",
                        "skill-a",
                        "SUCCESS",
                        "Skill 已安装",
                        null
                ))
        ));

        mockMvc.perform(post("/api/skills/github/install")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"url":"https://github.com/acme/skills","targetIds":["target-1"],"skillPaths":["skills/skill-a"]}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.results[0].status").value("SUCCESS"));

        verify(githubSkillCollectionService).install(
                eq("https://github.com/acme/skills"),
                eq(List.of("target-1")),
                eq(List.of("skills/skill-a"))
        );
    }

    @Test
    void updateVersionDelegatesToSkillService() throws Exception {
        when(skillService.updateSkillVersion("skill-1", "1.2.0"))
                .thenReturn(new SkillTypes.SkillListItem(
                        "skill-1",
                        "repo-1",
                        "1.2.0",
                        "digest",
                        "Skill",
                        "desc",
                        1,
                        0,
                        List.of(new SkillTypes.SkillDeploymentView("target-1", "/targets/one", "/targets/one/skill", true, LocalDateTime.now(), LocalDateTime.now())),
                        LocalDateTime.now(),
                        LocalDateTime.now()
                ));

        mockMvc.perform(post("/api/skills/skill-1/version")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":\"1.2.0\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.version").value("1.2.0"));

        verify(skillService).updateSkillVersion("skill-1", "1.2.0");
    }
}
