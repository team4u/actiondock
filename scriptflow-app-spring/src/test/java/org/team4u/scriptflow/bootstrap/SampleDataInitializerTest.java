package org.team4u.scriptflow.bootstrap;

import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.domain.model.ScriptDefinition;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SampleDataInitializerTest {
    @Test
    void runSeedsScriptSampleOnlyWhenMissing() {
        ScriptApplicationService scriptService = mock(ScriptApplicationService.class);
        when(scriptService.get("hello-groovy")).thenThrow(new IllegalArgumentException("missing"));

        new SampleDataInitializer(scriptService).run();

        verify(scriptService).save(org.mockito.ArgumentMatchers.any(ScriptDefinition.class));
        verify(scriptService).publish("hello-groovy");
    }

    @Test
    void runLeavesExistingScriptSampleUntouched() {
        ScriptApplicationService scriptService = mock(ScriptApplicationService.class);
        when(scriptService.get("hello-groovy")).thenReturn(new ScriptDefinition().setId("hello-groovy"));

        new SampleDataInitializer(scriptService).run();

        verify(scriptService, never()).save(org.mockito.ArgumentMatchers.any());
        verify(scriptService, never()).publish("hello-groovy");
    }
}
