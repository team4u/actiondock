package org.team4u.scriptflow.web;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.scriptflow.application.PageRuntimeApplicationService;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(PageRuntimeController.class)
@Import(GlobalExceptionHandler.class)
class PageRuntimeControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private PageRuntimeApplicationService pageRuntimeApplicationService;

    @Test
    void schemaReturnsRawRenderedMap() throws Exception {
        when(pageRuntimeApplicationService.schema("page-1")).thenReturn(Map.of("type", "page", "title", "Demo"));

        mockMvc.perform(get("/api/page-runtime/page-1/schema"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.type").value("page"))
                .andExpect(jsonPath("$.title").value("Demo"));
    }

    @Test
    void actionWrapsRuntimeResponse() throws Exception {
        when(pageRuntimeApplicationService.runAction(eq("page-1"), eq("submit"), any()))
                .thenReturn(Map.of("message", "Hello"));

        mockMvc.perform(post("/api/page-runtime/page-1/actions/submit")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Alice"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.message").value("Hello"));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> payloadCaptor = ArgumentCaptor.forClass(Map.class);
        verify(pageRuntimeApplicationService).runAction(eq("page-1"), eq("submit"), payloadCaptor.capture());
        assertThat(payloadCaptor.getValue()).containsEntry("name", "Alice");
    }

    @Test
    void actionMapsExceptionsToBadRequest() throws Exception {
        when(pageRuntimeApplicationService.runAction(eq("page-1"), eq("missing"), any()))
                .thenThrow(new IllegalArgumentException("Action not found: missing"));

        mockMvc.perform(post("/api/page-runtime/page-1/actions/missing")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.msg").value("Action not found: missing"));
    }
}
