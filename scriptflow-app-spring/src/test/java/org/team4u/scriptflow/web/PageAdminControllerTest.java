package org.team4u.scriptflow.web;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.scriptflow.application.PageDefinitionApplicationService;
import org.team4u.scriptflow.application.PageRuntimeApplicationService;
import org.team4u.scriptflow.domain.model.PageDefinition;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(PageAdminController.class)
@Import(GlobalExceptionHandler.class)
class PageAdminControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private PageDefinitionApplicationService pageDefinitionApplicationService;

    @MockBean
    private PageRuntimeApplicationService pageRuntimeApplicationService;

    @Test
    void updateUsesPathIdInsteadOfRequestBodyId() throws Exception {
        when(pageDefinitionApplicationService.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        mockMvc.perform(put("/api/pages/page-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"id":"other","name":"Updated"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value("page-1"))
                .andExpect(jsonPath("$.data.name").value("Updated"));

        verify(pageDefinitionApplicationService).save(any(PageDefinition.class));
    }

    @Test
    void submitDelegatesToRuntimeService() throws Exception {
        when(pageRuntimeApplicationService.submit(org.mockito.ArgumentMatchers.eq("page-1"), any()))
                .thenReturn(Map.of("message", "Hello"));

        mockMvc.perform(post("/api/pages/page-1/submit")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Alice"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.message").value("Hello"));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> payloadCaptor = ArgumentCaptor.forClass(Map.class);
        verify(pageRuntimeApplicationService).submit(org.mockito.ArgumentMatchers.eq("page-1"), payloadCaptor.capture());
        assertThat(payloadCaptor.getValue()).containsEntry("name", "Alice");
    }

    @Test
    void scaffoldMapsErrorsToBadRequest() throws Exception {
        when(pageDefinitionApplicationService.scaffold("page-1", "missing"))
                .thenThrow(new IllegalArgumentException("Script not found: missing"));

        mockMvc.perform(post("/api/pages/page-1/scaffold-from-script/missing"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.msg").value("Script not found: missing"));
    }
}
