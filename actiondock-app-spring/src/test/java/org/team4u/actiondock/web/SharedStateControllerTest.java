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
import org.team4u.actiondock.application.SharedStateApplicationService;
import org.team4u.actiondock.domain.model.SharedStateEntry;

import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        classes = RuntimeApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        properties = {
                "spring.config.name=does-not-exist",
                "server.port=0",
                "spring.datasource.url=jdbc:h2:mem:shared-state-controller;DB_CLOSE_DELAY=-1",
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
class SharedStateControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private SharedStateApplicationService sharedStateApplicationService;

    @Test
    void namespacesReturnsDistinctNamespaces() throws Exception {
        when(sharedStateApplicationService.listNamespaces()).thenReturn(List.of("oauth.github", "cache.shared"));

        mockMvc.perform(get("/api/shared-state/namespaces"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0]").value("oauth.github"))
                .andExpect(jsonPath("$.data[1]").value("cache.shared"));
    }

    @Test
    void listReturnsSummaryWithoutValue() throws Exception {
        when(sharedStateApplicationService.list("oauth.github")).thenReturn(List.of(
                new SharedStateEntry()
                        .setNamespace("oauth.github")
                        .setKey("token")
                        .setSecret(true)
                        .setVersion(2L)
                        .setUpdatedAt(LocalDateTime.of(2026, 4, 28, 12, 0))
        ));

        mockMvc.perform(get("/api/shared-state").param("namespace", "oauth.github"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].namespace").value("oauth.github"))
                .andExpect(jsonPath("$.data[0].key").value("token"))
                .andExpect(jsonPath("$.data[0].secret").value(true))
                .andExpect(jsonPath("$.data[0].version").value(2))
                .andExpect(jsonPath("$.data[0].value").doesNotExist());
    }

    @Test
    void detailReturnsValuePayload() throws Exception {
        when(sharedStateApplicationService.get("oauth.github", "token")).thenReturn(
                new SharedStateEntry()
                        .setNamespace("oauth.github")
                        .setKey("token")
                        .setValue(java.util.Map.of("accessToken", "abc"))
                        .setSecret(true)
                        .setVersion(1L)
        );

        mockMvc.perform(get("/api/shared-state/detail")
                        .param("namespace", "oauth.github")
                        .param("key", "token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.namespace").value("oauth.github"))
                .andExpect(jsonPath("$.data.key").value("token"))
                .andExpect(jsonPath("$.data.value.accessToken").value("abc"));
    }

    @Test
    void createPersistsStructuredPayload() throws Exception {
        when(sharedStateApplicationService.put(eq("oauth.github"), eq("token"), any(), eq(true), any(), eq(null), eq(null)))
                .thenReturn(new SharedStateEntry()
                        .setNamespace("oauth.github")
                        .setKey("token")
                        .setValue(java.util.Map.of("accessToken", "abc"))
                        .setSecret(true)
                        .setVersion(1L));

        mockMvc.perform(post("/api/shared-state")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "namespace":"oauth.github",
                                  "key":"token",
                                  "value":{"accessToken":"abc"},
                                  "secret":true
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.namespace").value("oauth.github"))
                .andExpect(jsonPath("$.data.value.accessToken").value("abc"))
                .andExpect(jsonPath("$.data.secret").value(true));
    }

    @Test
    void compareAndSetReturnsConflictPayload() throws Exception {
        when(sharedStateApplicationService.compareAndSet(eq("oauth.github"), eq("token"), eq(1L), any(), eq(false), any(), eq(null), eq(null)))
                .thenReturn(new SharedStateApplicationService.CompareAndSetResult(
                        false,
                        null,
                        new SharedStateEntry()
                                .setNamespace("oauth.github")
                                .setKey("token")
                                .setValue(java.util.Map.of("accessToken", "latest"))
                                .setVersion(2L)
                ));

        mockMvc.perform(post("/api/shared-state/cas")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "namespace":"oauth.github",
                                  "key":"token",
                                  "expectedVersion":1,
                                  "value":{"accessToken":"stale"}
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.updated").value(false))
                .andExpect(jsonPath("$.data.current.version").value(2))
                .andExpect(jsonPath("$.data.current.value.accessToken").value("latest"));
    }

    @Test
    void purgeExpiredReturnsDeletedCount() throws Exception {
        when(sharedStateApplicationService.purgeExpired("oauth.github")).thenReturn(3L);

        mockMvc.perform(post("/api/shared-state/purge-expired").param("namespace", "oauth.github"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(3));
    }

    @Test
    void deleteReturnsSuccess() throws Exception {
        mockMvc.perform(delete("/api/shared-state")
                        .param("namespace", "oauth.github")
                        .param("key", "token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.msg").value("共享状态已删除"));
    }
}
