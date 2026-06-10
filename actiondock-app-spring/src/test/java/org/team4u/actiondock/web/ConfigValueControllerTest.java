package org.team4u.actiondock.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.team4u.actiondock.web.common.GlobalExceptionHandler;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.actiondock.RuntimeApplication;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.domain.model.ConfigValue;

import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        classes = RuntimeApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        properties = {
                "spring.config.name=does-not-exist",
                "server.port=0",
                "spring.datasource.url=jdbc:h2:mem:config-value-controller;DB_CLOSE_DELAY=-1",
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
class ConfigValueControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ConfigValueApplicationService configValueApplicationService;

    @Test
    void listReturnsConfigValues() throws Exception {
        when(configValueApplicationService.list()).thenReturn(List.of(
                new ConfigValue()
                        .setKey("openai.api_key")
                        .setValue("sk-test")
                        .setDescription("OpenAI key")
                        .setSecret(true)
                        .setUpdatedAt(LocalDateTime.of(2026, 4, 23, 12, 0))
        ));

        mockMvc.perform(get("/api/config-values"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].key").value("openai.api_key"))
                .andExpect(jsonPath("$.data[0].value").doesNotExist())
                .andExpect(jsonPath("$.data[0].valueMasked").value("********"))
                .andExpect(jsonPath("$.data[0].secret").value(true))
                .andExpect(jsonPath("$.data[0].description").value("OpenAI key"));
    }

    @Test
    void updateUsesPathKey() throws Exception {
        when(configValueApplicationService.update(eq("openai.api_key"), any(), anyBoolean())).thenReturn(
                new ConfigValue()
                        .setKey("openai.api_key")
                        .setValue("sk-live")
                        .setDescription("Live key")
        );

        mockMvc.perform(put("/api/config-values/openai.api_key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"key":"other.key","value":"sk-live","description":"Live key"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.key").value("openai.api_key"))
                .andExpect(jsonPath("$.data.value").value("sk-live"));
    }

    @Test
    void createReturnsCreatedConfigValue() throws Exception {
        when(configValueApplicationService.create(any())).thenReturn(
                new ConfigValue()
                        .setKey("service.url")
                        .setValue("https://svc.example.com")
        );

        mockMvc.perform(post("/api/config-values")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"key":"service.url","value":"https://svc.example.com"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.key").value("service.url"))
                .andExpect(jsonPath("$.data.value").value("https://svc.example.com"));
    }
}
