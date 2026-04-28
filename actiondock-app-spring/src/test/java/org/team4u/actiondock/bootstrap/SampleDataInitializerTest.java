package org.team4u.actiondock.bootstrap;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.model.ScriptDefinition;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SampleDataInitializerTest {
    @Test
    void runSeedsScriptSampleOnlyWhenMissing() {
        ScriptApplicationService scriptService = mock(ScriptApplicationService.class);
        ConfigValueApplicationService configService = mock(ConfigValueApplicationService.class);
        when(scriptService.get("hello-groovy")).thenThrow(new IllegalArgumentException("missing"));
        when(configService.get("system.default-owner")).thenThrow(new IllegalArgumentException("missing"));

        new SampleDataInitializer(scriptService, configService).run();

        verify(scriptService).save(org.mockito.ArgumentMatchers.any(ScriptDefinition.class));
        verify(scriptService).publish("hello-groovy");
    }

    @Test
    void runLeavesExistingScriptSampleUntouched() {
        ScriptApplicationService scriptService = mock(ScriptApplicationService.class);
        ConfigValueApplicationService configService = mock(ConfigValueApplicationService.class);
        when(scriptService.get("hello-groovy")).thenReturn(new ScriptDefinition().setId("hello-groovy"));
        when(configService.get("system.default-owner")).thenReturn(new ConfigValue().setKey("system.default-owner").setValue("test"));

        new SampleDataInitializer(scriptService, configService).run();

        verify(scriptService, never()).save(org.mockito.ArgumentMatchers.any());
        verify(scriptService, never()).publish("hello-groovy");
    }
}
