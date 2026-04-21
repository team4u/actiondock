package org.team4u.scriptflow.bootstrap;

import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.application.PageDefinitionApplicationService;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.domain.model.PageDefinition;
import org.team4u.scriptflow.domain.model.ScriptDefinition;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SampleDataInitializerTest {
    @Test
    void runSeedsSampleDataOnlyWhenEntriesAreMissing() {
        ScriptApplicationService scriptService = mock(ScriptApplicationService.class);
        PageDefinitionApplicationService pageService = mock(PageDefinitionApplicationService.class);
        when(scriptService.get("hello-groovy")).thenThrow(new IllegalArgumentException("missing"));
        when(pageService.get("hello-page")).thenThrow(new IllegalArgumentException("missing"));

        new SampleDataInitializer(scriptService, pageService).run();

        verify(scriptService).save(org.mockito.ArgumentMatchers.any(ScriptDefinition.class));
        verify(scriptService).publish("hello-groovy");
        verify(pageService).scaffold("hello-page", "hello-groovy");
    }

    @Test
    void runLeavesExistingSampleDataUntouched() {
        ScriptApplicationService scriptService = mock(ScriptApplicationService.class);
        PageDefinitionApplicationService pageService = mock(PageDefinitionApplicationService.class);
        when(scriptService.get("hello-groovy")).thenReturn(new ScriptDefinition().setId("hello-groovy"));
        when(pageService.get("hello-page")).thenReturn(new PageDefinition().setId("hello-page"));

        new SampleDataInitializer(scriptService, pageService).run();

        verify(scriptService, never()).save(org.mockito.ArgumentMatchers.any());
        verify(scriptService, never()).publish("hello-groovy");
        verify(pageService, never()).scaffold("hello-page", "hello-groovy");
    }
}
