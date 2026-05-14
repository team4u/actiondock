package org.team4u.actiondock.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.actiondock.RuntimeApplication;
import org.team4u.actiondock.application.WebhookApplicationService;
import org.team4u.actiondock.application.WebhookExecutionApplicationService;
import org.team4u.actiondock.repository.RepositoryWebhookService;
import org.team4u.actiondock.web.common.GlobalExceptionHandler;

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
                "spring.datasource.url=jdbc:h2:mem:webhook-controller;DB_CLOSE_DELAY=-1",
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
class WebhookManagementControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private WebhookApplicationService webhookApplicationService;

    @MockBean
    private WebhookExecutionApplicationService webhookExecutionApplicationService;

    @MockBean
    private RepositoryWebhookService repositoryWebhookService;

    @Test
    void upstreamStatusReturnsNullWhenWebhookHasNoBinding() throws Exception {
        when(repositoryWebhookService.getUpstreamStatus("source-1")).thenReturn(null);

        mockMvc.perform(get("/api/webhooks/source-1/upstream"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(0))
                .andExpect(jsonPath("$.data").doesNotExist());
    }
}
