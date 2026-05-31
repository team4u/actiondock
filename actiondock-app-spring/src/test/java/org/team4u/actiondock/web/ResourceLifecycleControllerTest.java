package org.team4u.actiondock.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.actiondock.RuntimeApplication;
import org.team4u.actiondock.repository.RepositoryCapabilityPackageService;
import org.team4u.actiondock.repository.RepositoryCatalogService;
import org.team4u.actiondock.repository.RepositoryCatalogTypes;
import org.team4u.actiondock.repository.RepositoryKnowledgeService;
import org.team4u.actiondock.repository.RepositoryPluginService;
import org.team4u.actiondock.repository.RepositoryPlaybookService;
import org.team4u.actiondock.repository.RepositoryScriptService;
import org.team4u.actiondock.repository.RepositoryWebhookService;
import org.team4u.actiondock.web.common.GlobalExceptionHandler;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
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
                "spring.datasource.url=jdbc:h2:mem:resource-lifecycle-controller;DB_CLOSE_DELAY=-1",
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
class ResourceLifecycleControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private RepositoryCatalogService repositoryCatalogService;

    @MockBean
    private RepositoryScriptService repositoryToolService;

    @MockBean
    private RepositoryWebhookService repositoryWebhookService;

    @MockBean
    private RepositoryPluginService repositoryPluginService;

    @MockBean
    private RepositoryCapabilityPackageService repositoryCapabilityPackageService;

    @MockBean
    private RepositoryKnowledgeService repositoryKnowledgeService;

    @MockBean
    private RepositoryPlaybookService repositoryPlaybookService;

    @Test
    void routesWebhookPublishThroughLifecycleFacade() throws Exception {
        when(repositoryWebhookService.publishWebhook(any(), any())).thenReturn(
                new RepositoryCatalogTypes.RepositoryWebhookDescriptor(
                        "repo-1",
                        "order-created",
                        "Order Created",
                        "1.0.0",
                        "desc",
                        null,
                        "team",
                        List.of("demo"),
                        "webhooks/order-created/webhook.json",
                        null,
                        null,
                        List.of(),
                        true,
                        null
                )
        );

        mockMvc.perform(post("/api/resource-lifecycle/operations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "resourceType": "REPOSITORY_WEBHOOK",
                                  "operation": "publish",
                                  "repositoryId": "repo-1",
                                  "payload": {
                                    "sourceId": "source-1",
                                    "webhookId": "order-created",
                                    "displayName": "Order Created",
                                    "version": "1.0.0",
                                    "scriptDependencies": [],
                                    "publishScriptDependencies": true,
                                    "configItems": [],
                                    "force": false
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(0))
                .andExpect(jsonPath("$.data.resourceType").value("REPOSITORY_WEBHOOK"))
                .andExpect(jsonPath("$.data.operation").value("publish"))
                .andExpect(jsonPath("$.data.result.webhookId").value("order-created"));

        verify(repositoryWebhookService).publishWebhook(any(), any());
    }

    @Test
    void routesPlaybookPublishThroughLifecycleFacade() throws Exception {
        when(repositoryPlaybookService.publishPlaybook(any(), any())).thenReturn(
                new RepositoryCatalogTypes.RepositoryPlaybookDescriptor(
                        "repo-1",
                        "refund-failure",
                        "退款失败排查",
                        "1.0.0",
                        "desc",
                        null,
                        "team",
                        List.of("refund"),
                        "MEDIUM",
                        "playbooks/refund-failure/playbook.json",
                        null,
                        true,
                        null
                )
        );

        mockMvc.perform(post("/api/resource-lifecycle/operations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "resourceType": "REPOSITORY_PLAYBOOK",
                                  "operation": "publish",
                                  "repositoryId": "repo-1",
                                  "payload": {
                                    "sourceId": "refund-failure",
                                    "playbookId": "refund-failure",
                                    "displayName": "退款失败排查",
                                    "version": "1.0.0",
                                    "force": false
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(0))
                .andExpect(jsonPath("$.data.resourceType").value("REPOSITORY_PLAYBOOK"))
                .andExpect(jsonPath("$.data.operation").value("publish"))
                .andExpect(jsonPath("$.data.result.playbookId").value("refund-failure"));

        verify(repositoryPlaybookService).publishPlaybook(any(), any());
    }
}
