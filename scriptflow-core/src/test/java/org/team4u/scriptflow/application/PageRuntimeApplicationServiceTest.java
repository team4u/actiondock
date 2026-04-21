package org.team4u.scriptflow.application;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.ExecutionStatus;
import org.team4u.scriptflow.domain.model.PageActionDefinition;
import org.team4u.scriptflow.domain.model.PageBinding;
import org.team4u.scriptflow.domain.model.PageDefinition;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.SubmitMode;
import org.team4u.scriptflow.domain.model.ViewSchema;
import org.team4u.scriptflow.domain.port.PageRepository;
import org.team4u.scriptflow.domain.port.PageSchemaBuilder;
import org.team4u.scriptflow.domain.port.PageSchemaRenderer;
import org.team4u.scriptflow.domain.port.ScriptRepository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PageRuntimeApplicationServiceTest {
    private final PageRepository pageRepository = mock(PageRepository.class);
    private final ScriptRepository scriptRepository = mock(ScriptRepository.class);
    private final ExecutionApplicationService executionApplicationService = mock(ExecutionApplicationService.class);
    private final PageSchemaBuilder pageSchemaBuilder = mock(PageSchemaBuilder.class);
    private final PageSchemaRenderer pageSchemaRenderer = mock(PageSchemaRenderer.class);
    private final PageRuntimeApplicationService service = new PageRuntimeApplicationService(
            pageRepository,
            scriptRepository,
            executionApplicationService,
            pageSchemaBuilder,
            pageSchemaRenderer
    );

    @Test
    void schemaLoadsPageAndScriptThenBuildsAndRendersView() {
        PageDefinition page = pageDefinition();
        ScriptDefinition script = new ScriptDefinition().setId("script-1");
        ViewSchema viewSchema = new ViewSchema().setPageId("page-1");
        Map<String, Object> rendered = Map.of("type", "page");
        when(pageRepository.findById("page-1")).thenReturn(Optional.of(page));
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(script));
        when(pageSchemaBuilder.build(page, script)).thenReturn(viewSchema);
        when(pageSchemaRenderer.render(viewSchema)).thenReturn(rendered);

        Map<String, Object> result = service.schema("page-1");

        assertThat(result).isEqualTo(rendered);
        verify(pageSchemaBuilder).build(page, script);
        verify(pageSchemaRenderer).render(viewSchema);
    }

    @Test
    void runActionMapsPayloadToScriptInputAndOutputBackToPageFields() {
        when(pageRepository.findById("page-1")).thenReturn(Optional.of(pageDefinition()));
        when(executionApplicationService.execute(eq("script-1"), any(), eq(SubmitMode.SYNC))).thenReturn(new ExecutionRecord()
                .setId("exec-1")
                .setStatus(ExecutionStatus.SUCCESS)
                .setDisplayOutput(new LinkedHashMap<>(Map.of("message", "Hello"))));

        Map<String, Object> result = service.runAction("page-1", "submit", Map.of("pageName", "Alice"));

        assertThat(result).containsEntry("resultMessage", "Hello");
        assertThat(result).containsEntry("executionId", "exec-1");
        assertThat(result).containsEntry("status", ExecutionStatus.SUCCESS);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> inputCaptor = ArgumentCaptor.forClass(Map.class);
        verify(executionApplicationService).execute(eq("script-1"), inputCaptor.capture(), eq(SubmitMode.SYNC));
        assertThat(inputCaptor.getValue()).containsExactlyEntriesOf(Map.of("name", "Alice"));
    }

    @Test
    void runActionUsesAsyncOverrideWhenActionRequestsIt() {
        PageDefinition page = pageDefinition();
        page.getActions().getFirst().setOptions(Map.of("async", true));
        when(pageRepository.findById("page-1")).thenReturn(Optional.of(page));
        when(executionApplicationService.execute(eq("script-1"), any(), eq(SubmitMode.ASYNC))).thenReturn(new ExecutionRecord()
                .setId("exec-1")
                .setSubmitMode(SubmitMode.ASYNC)
                .setStatus(ExecutionStatus.PENDING));

        Map<String, Object> result = service.runAction("page-1", "submit", Map.of("pageName", "Alice"));

        assertThat(result)
                .containsEntry("executionId", "exec-1")
                .containsEntry("status", ExecutionStatus.PENDING);
    }

    @Test
    void submitReturnsDisplayOutputDirectlyWhenNoOutputMappingExists() {
        PageDefinition page = pageDefinition();
        page.getBinding().setOutputMapping(Map.of());
        when(pageRepository.findById("page-1")).thenReturn(Optional.of(page));
        when(executionApplicationService.execute(eq("script-1"), any(), eq(SubmitMode.SYNC))).thenReturn(new ExecutionRecord()
                .setId("exec-1")
                .setStatus(ExecutionStatus.SUCCESS)
                .setDisplayOutput(new LinkedHashMap<>(Map.of("message", "Hello"))));

        Map<String, Object> result = service.submit("page-1", Map.of("pageName", "Alice"));

        assertThat(result).containsExactlyEntriesOf(Map.of("message", "Hello"));
    }

    @Test
    void runActionRejectsUnsupportedActionTypes() {
        PageDefinition page = pageDefinition();
        page.setActions(List.of(new PageActionDefinition()
                .setId("link")
                .setType("LINK")));
        when(pageRepository.findById("page-1")).thenReturn(Optional.of(page));

        assertThatThrownBy(() -> service.runAction("page-1", "link", Map.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Unsupported action type: LINK");
    }

    private static PageDefinition pageDefinition() {
        return new PageDefinition()
                .setId("page-1")
                .setName("Demo")
                .setActions(List.of(new PageActionDefinition()
                        .setId("submit")
                        .setType("SUBMIT")
                        .setMethod("POST")
                        .setOptions(Map.of("async", false))))
                .setBinding(new PageBinding()
                        .setScriptId("script-1")
                        .setSubmitMode(SubmitMode.SYNC)
                        .setInputMapping(Map.of("pageName", "name"))
                        .setOutputMapping(Map.of("message", "resultMessage")));
    }
}
