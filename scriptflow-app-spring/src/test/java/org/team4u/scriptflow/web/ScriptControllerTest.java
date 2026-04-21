package org.team4u.scriptflow.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.domain.model.ScriptDefinition;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(ScriptController.class)
@Import(GlobalExceptionHandler.class)
class ScriptControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ScriptApplicationService scriptApplicationService;

    @Test
    void detailReturnsWrappedScriptDefinition() throws Exception {
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition().setId("script-1").setName("Hello"));

        mockMvc.perform(get("/api/scripts/script-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(0))
                .andExpect(jsonPath("$.data.id").value("script-1"))
                .andExpect(jsonPath("$.data.name").value("Hello"));
    }

    @Test
    void updateUsesPathIdInsteadOfRequestBodyId() throws Exception {
        when(scriptApplicationService.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        mockMvc.perform(put("/api/scripts/script-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"id":"other","name":"Updated","source":"return [:]"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value("script-1"))
                .andExpect(jsonPath("$.data.name").value("Updated"));

        verify(scriptApplicationService).save(any(ScriptDefinition.class));
    }

    @Test
    void validateMapsIllegalArgumentToBadRequest() throws Exception {
        org.mockito.Mockito.doThrow(new IllegalArgumentException("missing"))
                .when(scriptApplicationService).validate("missing");

        mockMvc.perform(post("/api/scripts/missing/validate"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.msg").value("missing"));
    }
}
