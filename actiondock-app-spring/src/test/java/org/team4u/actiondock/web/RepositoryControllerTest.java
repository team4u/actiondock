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
import org.team4u.actiondock.repository.RepositoryCatalogService;
import org.team4u.actiondock.repository.RepositoryCatalogTypes;
import org.team4u.actiondock.repository.RepositorySkillService;

import java.util.List;

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
                "spring.datasource.url=jdbc:h2:mem:repository-controller;DB_CLOSE_DELAY=-1",
                "spring.datasource.driver-class-name=org.h2.Driver",
                "spring.datasource.username=sa",
                "spring.jpa.hibernate.ddl-auto=create-drop",
                "spring.jpa.open-in-view=false",
                "spring.h2.console.enabled=false",
                "app.execution.async-pool-size=1"
        }
)
@AutoConfigureMockMvc
class RepositoryControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private RepositoryCatalogService repositoryCatalogService;

    @MockBean
    private RepositorySkillService repositorySkillService;

    @Test
    void listSupportsPurposeFilter() throws Exception {
        when(repositoryCatalogService.listRepositories("PROJECT"))
                .thenReturn(java.util.List.of(new org.team4u.actiondock.domain.model.RepositoryDefinition()
                        .setId("billing-service")
                        .setName("Billing Service")
                        .setType("LOCAL_DIR")
                        .setPurpose("PROJECT")
                        .setUrl("/tmp/billing")));

        mockMvc.perform(get("/api/repositories").param("purpose", "PROJECT"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value("billing-service"))
                .andExpect(jsonPath("$.data[0].purpose").value("PROJECT"));

        verify(repositoryCatalogService).listRepositories("PROJECT");
    }

    @Test
    void resolveProjectReturnsMarkdownContent() throws Exception {
        when(repositoryCatalogService.resolveProjectRepository("billing-service"))
                .thenReturn(new RepositoryCatalogService.ProjectRepositoryResolution(
                        "billing-service",
                        "LOCAL_DIR",
                        "PROJECT",
                        "/tmp/billing",
                        "ACTIONDOCK.md",
                        true,
                        true,
                        "# Billing Service"
                ));

        mockMvc.perform(get("/api/repositories/resolve").param("repositoryId", "billing-service"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.repositoryId").value("billing-service"))
                .andExpect(jsonPath("$.data.entryPath").value("ACTIONDOCK.md"))
                .andExpect(jsonPath("$.data.content").value("# Billing Service"));
    }

    @Test
    void projectFileRoutesReturnTreeAndPreview() throws Exception {
        when(repositoryCatalogService.listProjectRepositoryFiles("billing-service", null))
                .thenReturn(List.of(
                        new RepositoryCatalogTypes.RepositoryProjectFileNode("docs", "docs", true, null, true),
                        new RepositoryCatalogTypes.RepositoryProjectFileNode("README.md", "README.md", false, 128L, false)
                ));
        when(repositoryCatalogService.previewProjectRepositoryFile("billing-service", "docs/runbook.md"))
                .thenReturn(new RepositoryCatalogTypes.RepositoryProjectFilePreview(
                        "docs/runbook.md",
                        "runbook.md",
                        false,
                        "text/markdown",
                        64L,
                        "MARKDOWN",
                        "markdown",
                        "# Runbook",
                        null,
                        false
                ));

        mockMvc.perform(get("/api/repositories/billing-service/project-files"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].path").value("docs"))
                .andExpect(jsonPath("$.data[0].directory").value(true))
                .andExpect(jsonPath("$.data[1].path").value("README.md"));

        mockMvc.perform(get("/api/repositories/billing-service/project-files/preview").param("path", "docs/runbook.md"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.path").value("docs/runbook.md"))
                .andExpect(jsonPath("$.data.previewType").value("MARKDOWN"))
                .andExpect(jsonPath("$.data.textContent").value("# Runbook"));
    }

    @Test
    void repositoryScriptRoutesReturnScriptDescriptor() throws Exception {
        RepositoryCatalogTypes.RepositoryScriptDescriptor descriptor = new RepositoryCatalogTypes.RepositoryScriptDescriptor(
                "repo-1",
                "hello-groovy",
                "Hello Groovy",
                "1.0.0",
                "desc",
                null,
                "team",
                List.of(),
                "GROOVY",
                "TOOL",
                "scripts/hello-groovy/source.groovy",
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                List.of(),
                List.of(),
                true,
                null
        );
        when(repositoryCatalogService.listAllRepositoryScripts()).thenReturn(List.of(descriptor));
        when(repositoryCatalogService.listRepositoryScripts("repo-1")).thenReturn(List.of(descriptor));
        when(repositoryCatalogService.getRepositoryScript("repo-1", "hello-groovy"))
                .thenReturn(new RepositoryCatalogTypes.RepositoryScriptDetail(descriptor, "return [message: 'ok']", null, List.of(), List.of()));

        mockMvc.perform(get("/api/repositories/scripts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].scriptId").value("hello-groovy"))
                .andExpect(jsonPath("$.data[0].toolId").doesNotExist());

        mockMvc.perform(get("/api/repositories/repo-1/scripts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].scriptId").value("hello-groovy"))
                .andExpect(jsonPath("$.data[0].toolId").doesNotExist());

        mockMvc.perform(get("/api/repositories/repo-1/scripts/hello-groovy"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.descriptor.scriptId").value("hello-groovy"))
                .andExpect(jsonPath("$.data.descriptor.toolId").doesNotExist())
                .andExpect(jsonPath("$.data.source").value("return [message: 'ok']"));
    }

    @Test
    void skillArchiveReturnsBinaryDownload() throws Exception {
        when(repositorySkillService.exportRepositorySkillArchive("repo-1", "skill-1"))
                .thenReturn(new RepositoryCatalogTypes.RepositoryBinaryArchive("skill-1.zip", "zip-content".getBytes()));

        mockMvc.perform(get("/api/repositories/repo-1/skills/skill-1/archive"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"skill-1.zip\""))
                .andExpect(content().bytes("zip-content".getBytes()));
    }

    @Test
    void publishSkillArchiveDelegatesToRepositoryService() throws Exception {
        when(repositoryCatalogService.publishSkillArchive(eq("repo-1"), eq("1.2.1"), eq("notes"), eq("skill.zip"), any()))
                .thenReturn(new RepositoryCatalogTypes.RepositorySkillDescriptor(
                        "repo-1",
                        "skill-1",
                        "Skill 1",
                        "1.2.0",
                        "desc",
                        null,
                        null,
                        java.util.List.of(),
                        "skills/skill-1/skill.json",
                        "skills/skill-1/SKILL.md",
                        "digest",
                        null,
                        true,
                        null,
                        false,
                        true
                ));

        mockMvc.perform(multipart("/api/repositories/repo-1/publish-skill-archive")
                        .file(new MockMultipartFile("archive", "skill.zip", MediaType.APPLICATION_OCTET_STREAM_VALUE, "zip".getBytes()))
                        .param("version", "1.2.1")
                        .param("releaseNotes", "notes"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.repositoryId").value("repo-1"))
                .andExpect(jsonPath("$.data.skillId").value("skill-1"))
                .andExpect(jsonPath("$.data.version").value("1.2.0"));

        verify(repositoryCatalogService).publishSkillArchive(eq("repo-1"), eq("1.2.1"), eq("notes"), eq("skill.zip"), any());
    }
}
