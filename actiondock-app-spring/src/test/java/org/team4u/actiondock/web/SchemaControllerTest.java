package org.team4u.actiondock.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.team4u.actiondock.web.common.GlobalExceptionHandler;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.actiondock.RuntimeApplication;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.ScriptDefinition;

import java.util.List;
import java.util.Map;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        classes = RuntimeApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        properties = {
                "spring.config.name=does-not-exist",
                "server.port=0",
                "spring.datasource.url=jdbc:h2:mem:schema-controller;DB_CLOSE_DELAY=-1",
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
class SchemaControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ScriptApplicationService scriptApplicationService;

    @Test
    void detailReturnsOnlyInputAndOutput() throws Exception {
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition()
                .setId("script-1")
                .setName("Hello")
                .setInputSchema(Map.of(
                        "type", "object",
                        "required", List.of("name"),
                        "properties", Map.of(
                                "name", Map.of(
                                        "type", "string",
                                        "title", "Name",
                                        "description", "脚本名称",
                                        "default", "guest"
                                ),
                                "profile", Map.of("type", "object", "title", "Profile")
                        )
                ))
                .setOutputSchema(Map.of(
                        "type", "object",
                        "properties", Map.of(
                                "message", Map.of("type", "string", "title", "Message")
                        )
                )));

        mockMvc.perform(get("/api/schema/script-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.input[?(@.name=='name')]").exists())
                .andExpect(jsonPath("$.data.input[?(@.name=='profile')]").exists())
                .andExpect(jsonPath("$.data.input[?(@.name=='name')].description").value(contains("脚本名称")))
                .andExpect(jsonPath("$.data.input[?(@.name=='name')].defaultValue").value(contains("guest")))
                .andExpect(jsonPath("$.data.input[?(@.name=='profile')][0].required").doesNotExist())
                .andExpect(jsonPath("$.data.output[0].name").value("message"))
                .andExpect(jsonPath("$.data.output[0].required").doesNotExist())
                .andExpect(content().string(containsString("\"required\":true")))
                .andExpect(content().string(not(containsString("\"description\":null"))))
                .andExpect(content().string(not(containsString("\"enumValues\":[]"))))
                .andExpect(content().string(not(containsString("\"defaultValue\":null"))))
                .andExpect(content().string(not(containsString("\"examples\":[]"))))
                .andExpect(content().string(not(containsString("\"required\":false"))))
                .andExpect(jsonPath("$.data.id").doesNotExist())
                .andExpect(jsonPath("$.data.name").doesNotExist())
                .andExpect(jsonPath("$.data.type").doesNotExist());
    }

    @Test
    void detailOmitsMissingSides() throws Exception {
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition()
                .setId("script-1")
                .setName("Hello"));

        mockMvc.perform(get("/api/schema/script-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.input").doesNotExist())
                .andExpect(jsonPath("$.data.output").doesNotExist());
    }
}
