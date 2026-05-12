package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.EventSourceDefinition;
import org.team4u.actiondock.domain.model.EventSourceScope;
import org.team4u.actiondock.domain.model.EventTrigger;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.domain.port.EventSourceRepository;
import org.team4u.actiondock.domain.port.EventTriggerRepository;
import org.team4u.actiondock.domain.port.ProcessorEngine;
import org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository;

import java.util.List;
import java.util.Optional;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EventSourceApplicationServiceTest {
    private final EventSourceRepository eventSourceRepository = mock(EventSourceRepository.class);
    private final EventTriggerRepository eventTriggerRepository = mock(EventTriggerRepository.class);
    private final ProcessorEngine processorEngine = mock(ProcessorEngine.class);
    private final RepositoryLocalAssetRepository repositoryLocalAssetRepository = mock(RepositoryLocalAssetRepository.class);
    private final EventSourceApplicationService service = new EventSourceApplicationService(
            eventSourceRepository,
            eventTriggerRepository,
            processorEngine,
            repositoryLocalAssetRepository
    );

    @Test
    void deleteRemovesWorkingCopyTriggersAndLocalAsset() {
        when(eventSourceRepository.findById("source-1")).thenReturn(Optional.of(new EventSourceDefinition()
                .setId("source-1")
                .setScope(EventSourceScope.PERSONAL)));
        when(eventTriggerRepository.findBySourceId("source-1")).thenReturn(List.of(
                new EventTrigger().setId("trigger-1"),
                new EventTrigger().setId("trigger-2")
        ));
        when(repositoryLocalAssetRepository.findByLocalAsset(UpstreamAssetType.EVENT_SOURCE, "source-1"))
                .thenReturn(Optional.of(new RepositoryLocalAsset()
                        .setId("asset-1")
                        .setAssetType(UpstreamAssetType.EVENT_SOURCE)
                        .setLocalAssetId("source-1")));

        service.delete("source-1");

        verify(eventTriggerRepository).deleteById("trigger-1");
        verify(eventTriggerRepository).deleteById("trigger-2");
        verify(repositoryLocalAssetRepository).deleteById("asset-1");
        verify(eventSourceRepository).deleteById("source-1");
    }

    @Test
    void deleteSkipsLocalAssetRemovalWhenSourceHasNoLocalAsset() {
        when(eventSourceRepository.findById("source-1")).thenReturn(Optional.of(new EventSourceDefinition()
                .setId("source-1")
                .setScope(EventSourceScope.PERSONAL)));
        when(eventTriggerRepository.findBySourceId("source-1")).thenReturn(List.of());
        when(repositoryLocalAssetRepository.findByLocalAsset(UpstreamAssetType.EVENT_SOURCE, "source-1"))
                .thenReturn(Optional.empty());

        service.delete("source-1");

        verify(repositoryLocalAssetRepository, never()).deleteById("asset-1");
        verify(eventSourceRepository).deleteById("source-1");
    }
}
