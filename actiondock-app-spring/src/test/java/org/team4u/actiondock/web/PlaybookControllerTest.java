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
import org.team4u.actiondock.application.PlaybookApplicationService;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookPage;
import org.team4u.actiondock.domain.model.PlaybookQuery;
import org.team4u.actiondock.domain.model.PlaybookRiskLevel;
import org.team4u.actiondock.repository.RepositoryCatalogService;
import org.team4u.actiondock.repository.RepositoryPlaybookService;
import org.team4u.actiondock.repository.RepositoryScriptService;
import org.team4u.actiondock.web.common.GlobalExceptionHandler;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * PlaybookController HTTP 层边界测试。
 * <p>
 * 覆盖 GET /api/playbooks 的条件过滤与意图过滤、托管任务手册不可编辑/删除、
 * 普通 POST 不能创建托管资产、以及可选分页参数。
 *
 * @author jay.wu
 */
@SpringBootTest(
        classes = RuntimeApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        properties = {
                "spring.config.name=does-not-exist",
                "server.port=0",
                "spring.datasource.url=jdbc:h2:mem:playbook-controller;DB_CLOSE_DELAY=-1",
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
class PlaybookControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private PlaybookApplicationService playbookService;

    @MockBean
    private RepositoryCatalogService repositoryCatalogService;

    @MockBean
    private RepositoryScriptService repositoryScriptService;

    @MockBean
    private RepositoryPlaybookService repositoryPlaybookService;

    @Test
    void listAppliesRepositoryIdTagEnabledManagedFilters() throws Exception {
        when(playbookService.listPlaybooks(eq("billing-service"), eq("refund"), eq(true), eq(null)))
                .thenReturn(List.of(playbook("refund", "退款失败排查", true, false)));

        mockMvc.perform(get("/api/playbooks")
                        .param("repositoryId", "billing-service")
                        .param("tag", "refund")
                        .param("enabled", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(0))
                .andExpect(jsonPath("$.data[0].id").value("refund"))
                .andExpect(jsonPath("$.data[0].name").value("退款失败排查"));
    }

    @Test
    void listFiltersByManagedFlag() throws Exception {
        when(playbookService.listPlaybooks(isNull(), isNull(), isNull(), eq(true)))
                .thenReturn(List.of(playbook("capability.refund", "托管退款", true, true)));

        mockMvc.perform(get("/api/playbooks").param("managed", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value("capability.refund"))
                .andExpect(jsonPath("$.data[0].managed").value(true));
    }

    @Test
    void listAppliesIntentFilter() throws Exception {
        Playbook refund = playbook("refund", "退款失败排查", true, false);
        Playbook other = playbook("billing", "账单对账", true, false);
        when(playbookService.listPlaybooks(isNull(), isNull(), isNull(), isNull()))
                .thenReturn(List.of(refund, other));

        // intent 仅匹配 "退款" 相关任务手册
        mockMvc.perform(get("/api/playbooks").param("intent", "退款"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value("refund"))
                .andExpect(jsonPath("$.data.length()").value(1));
    }

    @Test
    void listWithoutFiltersReturnsAllAndDelegatesUnpaged() throws Exception {
        when(playbookService.listPlaybooks(isNull(), isNull(), isNull(), isNull()))
                .thenReturn(List.of(playbook("a", "A", true, false), playbook("b", "B", true, false)));

        mockMvc.perform(get("/api/playbooks"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2));

        verify(playbookService).listPlaybooks(null, null, null, null);
    }

    @Test
    void listWithPagingReturnsPageEnvelope() throws Exception {
        when(playbookService.findPage(any(PlaybookQuery.class)))
                .thenReturn(new PlaybookPage(
                        List.of(playbook("refund", "退款失败排查", true, false)),
                        0,
                        10,
                        25L,
                        3));

        mockMvc.perform(get("/api/playbooks").param("page", "0").param("size", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].id").value("refund"))
                .andExpect(jsonPath("$.data.page").value(0))
                .andExpect(jsonPath("$.data.size").value(10))
                .andExpect(jsonPath("$.data.totalElements").value(25))
                .andExpect(jsonPath("$.data.totalPages").value(3));

        verify(playbookService).findPage(any(PlaybookQuery.class));
    }

    @Test
    void managedPlaybookCannotBeEditedViaPut() throws Exception {
        org.mockito.Mockito.doThrow(ActionDockException.conflict(
                        ActionDockErrorCodes.PLAYBOOK_NOT_EDITABLE,
                        "能力包安装的任务手册为只读",
                        Map.of("playbookId", "capability.refund")))
                .when(playbookService).updatePlaybook(eq("capability.refund"), any());

        mockMvc.perform(put("/api/playbooks/capability.refund")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":\"capability.refund\",\"name\":\"篡改\",\"guideMarkdown\":\"g\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.data.code").value("PLAYBOOK_NOT_EDITABLE"));
    }

    @Test
    void managedPlaybookCannotBeDeletedViaDelete() throws Exception {
        org.mockito.Mockito.doThrow(ActionDockException.conflict(
                        ActionDockErrorCodes.PLAYBOOK_NOT_EDITABLE,
                        "能力包安装的任务手册为只读",
                        Map.of("playbookId", "capability.refund")))
                .when(playbookService).deletePlaybook("capability.refund");

        mockMvc.perform(delete("/api/playbooks/capability.refund"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.data.code").value("PLAYBOOK_NOT_EDITABLE"));
    }

    @Test
    void normalPostCannotCreateManagedAsset() throws Exception {
        // 应用层保证普通 save 永远不会产出 managed 资产，此处校验响应中 managed=false
        when(playbookService.savePlaybook(any())).thenAnswer(invocation -> {
            Playbook playbook = invocation.getArgument(0);
            playbook.setManaged(false);
            return playbook;
        });

        mockMvc.perform(post("/api/playbooks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":\"p1\",\"name\":\"P1\",\"managed\":true,\"guideMarkdown\":\"g\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.managed").value(false));
    }

    @Test
    void getMissingPlaybookReturnsNotFound() throws Exception {
        org.mockito.Mockito.doThrow(ActionDockException.notFound(
                        ActionDockErrorCodes.PLAYBOOK_NOT_FOUND,
                        "任务手册不存在: missing",
                        Map.of("playbookId", "missing")))
                .when(playbookService).getPlaybook("missing");

        mockMvc.perform(get("/api/playbooks/missing"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.data.code").value("PLAYBOOK_NOT_FOUND"));
    }

    @Test
    void deleteReferencedPlaybookReturnsConflict() throws Exception {
        org.mockito.Mockito.doThrow(ActionDockException.conflict(
                        ActionDockErrorCodes.PLAYBOOK_IN_USE,
                        "无法删除任务手册，因为它被其他任务手册引用",
                        Map.of("referencingPlaybookIds", List.of("referrer"))))
                .when(playbookService).deletePlaybook("target");

        mockMvc.perform(delete("/api/playbooks/target"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.data.code").value("PLAYBOOK_IN_USE"))
                .andExpect(jsonPath("$.data.referencingPlaybookIds[0]").value("referrer"));
    }

    private static Playbook playbook(String id, String name, boolean enabled, boolean managed) {
        return new Playbook()
                .setId(id)
                .setName(name)
                .setEnabled(enabled)
                .setManaged(managed)
                .setGuideMarkdown("guide")
                .setRiskLevel(PlaybookRiskLevel.MEDIUM)
                .setTags(List.of("refund"))
                .setRepositoryIds(List.of("billing-service"));
    }
}
