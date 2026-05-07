package org.team4u.actiondock.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.team4u.actiondock.web.common.GlobalExceptionHandler;
import org.team4u.actiondock.web.script.ScriptPatchService;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.actiondock.RuntimeApplication;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.PluginDependency;
import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptStatus;

import java.util.List;
import java.util.Map;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        classes = RuntimeApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        properties = {
                "spring.config.name=does-not-exist",
                "server.port=0",
                "spring.datasource.url=jdbc:h2:mem:capability-controller;DB_CLOSE_DELAY=-1",
                "spring.datasource.driver-class-name=org.h2.Driver",
                "spring.datasource.username=sa",
                "spring.jpa.hibernate.ddl-auto=create-drop",
                "spring.jpa.open-in-view=false",
                "spring.h2.console.enabled=false",
                "app.execution.async-pool-size=1"
        }
)
@AutoConfigureMockMvc
@Import(GlobalExceptionHandler.class)
class CapabilityControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ScriptApplicationService scriptApplicationService;

    @MockBean
    private ScriptPatchService scriptPatchService;

    @MockBean
    private ExecutionApplicationService executionApplicationService;

    @Test
    void detailReturnsExpandedBindingsAndBackendChangeTruth() throws Exception {
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition()
                .setId("script-1")
                .setName("Live")
                .setSource("return [message: 'draft']")
                .setPythonRequirements("requests==2.31.0")
                .setDescription("draft desc")
                .setOwner("alice")
                .setTags(List.of("draft"))
                .setPluginDependencies(List.of(new PluginDependency()
                        .setPluginId("email-plugin")
                        .setVersionRange(">= 1.0.0")
                        .setRequiredActions(List.of("send"))))
                .setPublishedSnapshot(new PublishedScriptSnapshot()
                        .setName("Live")
                        .setSource("return [message: 'live']")
                        .setPythonRequirements("requests==2.30.0")
                        .setDescription("published desc")
                        .setOwner("platform")
                        .setTags(List.of("stable"))
                        .setPluginDependencies(List.of(new PluginDependency()
                                .setPluginId("email-plugin")
                                .setVersionRange(">= 1.0.0")
                                .setRequiredActions(List.of("send"))))
                        .setInputSchema(Map.of("type", "object"))
                        .setOutputSchema(Map.of("type", "object")))
                .setInputSchema(Map.of("type", "object"))
                .setOutputSchema(Map.of("type", "object"))
                .setStatus(ScriptStatus.PUBLISHED));

        mockMvc.perform(get("/api/capabilities/script-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.hasUnpublishedChanges").value(true))
                .andExpect(jsonPath("$.data.draftBinding.pythonRequirements").value("requests==2.31.0"))
                .andExpect(jsonPath("$.data.draftBinding.description").value("draft desc"))
                .andExpect(jsonPath("$.data.draftBinding.owner").value("alice"))
                .andExpect(jsonPath("$.data.draftBinding.tags[0]").value("draft"))
                .andExpect(jsonPath("$.data.draftBinding.pluginDependencies[0].pluginId").value("email-plugin"))
                .andExpect(jsonPath("$.data.publishedBinding.pythonRequirements").value("requests==2.30.0"))
                .andExpect(jsonPath("$.data.publishedBinding.description").value("published desc"))
                .andExpect(jsonPath("$.data.publishedBinding.owner").value("platform"))
                .andExpect(jsonPath("$.data.publishedBinding.tags[0]").value("stable"))
                .andExpect(jsonPath("$.data.publishedBinding.pluginDependencies[0].pluginId").value("email-plugin"))
                .andExpect(jsonPath("$.data.publishedBinding.version").doesNotExist());
    }
}
