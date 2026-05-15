package org.team4u.actiondock.bootstrap;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.repository.RepositoryCatalogService;

import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SampleDataInitializerTest {
    @Test
    void runSeedsScriptSampleOnlyWhenMissing() {
        ScriptApplicationService scriptService = mock(ScriptApplicationService.class);
        ConfigValueApplicationService configService = mock(ConfigValueApplicationService.class);
        ScriptRepository scriptRepository = mock(ScriptRepository.class);
        ConfigValueRepository configValueRepository = mock(ConfigValueRepository.class);
        RepositoryCatalogService repositoryCatalogService = mock(RepositoryCatalogService.class);
        when(scriptRepository.findById("hello-groovy")).thenReturn(Optional.empty());
        when(configValueRepository.findByKey("system.default-owner")).thenReturn(Optional.empty());

        new SampleDataInitializer(scriptService, configService, scriptRepository, configValueRepository, repositoryCatalogService).run();

        verify(scriptService).save(any(ScriptDefinition.class));
        verify(scriptService).publish("hello-groovy");
        verify(repositoryCatalogService).refreshRepositoryCache();
    }

    @Test
    void runLeavesExistingScriptSampleUntouched() {
        ScriptApplicationService scriptService = mock(ScriptApplicationService.class);
        ConfigValueApplicationService configService = mock(ConfigValueApplicationService.class);
        ScriptRepository scriptRepository = mock(ScriptRepository.class);
        ConfigValueRepository configValueRepository = mock(ConfigValueRepository.class);
        RepositoryCatalogService repositoryCatalogService = mock(RepositoryCatalogService.class);
        when(scriptRepository.findById("hello-groovy")).thenReturn(Optional.of(new ScriptDefinition().setId("hello-groovy")));
        when(configValueRepository.findByKey("system.default-owner")).thenReturn(Optional.of(new ConfigValue().setKey("system.default-owner").setValue("test")));

        new SampleDataInitializer(scriptService, configService, scriptRepository, configValueRepository, repositoryCatalogService).run();

        verify(scriptService, never()).save(any());
        verify(scriptService, never()).publish("hello-groovy");
        verify(repositoryCatalogService).refreshRepositoryCache();
    }
}
