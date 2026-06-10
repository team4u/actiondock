package org.team4u.actiondock.schedule;

import org.junit.jupiter.api.Test;
import org.springframework.scheduling.TaskScheduler;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.repository.RepositoryCatalogService;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.ScheduledFuture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RepositoryAutoSyncSchedulerTest {
    @Test
    void startsFixedRateTaskWhenAutoSyncEnabled() {
        RecordingTaskScheduler taskScheduler = new RecordingTaskScheduler();
        RepositoryCatalogService repositoryCatalogService = mock(RepositoryCatalogService.class);
        AppProperties properties = new AppProperties();

        RepositoryAutoSyncScheduler scheduler = new RepositoryAutoSyncScheduler(taskScheduler, repositoryCatalogService, properties);

        scheduler.onApplicationReady();

        assertThat(taskScheduler.invocationCount).isEqualTo(1);
        assertThat(taskScheduler.period).isEqualTo(Duration.ofSeconds(1800));
        assertThat((Object) taskScheduler.future).isSameAs(scheduler.scheduledFuture());
    }

    @Test
    void doesNotStartTaskWhenAutoSyncDisabled() {
        RecordingTaskScheduler taskScheduler = new RecordingTaskScheduler();
        RepositoryCatalogService repositoryCatalogService = mock(RepositoryCatalogService.class);
        AppProperties properties = new AppProperties();
        properties.getRepositories().setAutoSyncEnabled(false);

        RepositoryAutoSyncScheduler scheduler = new RepositoryAutoSyncScheduler(taskScheduler, repositoryCatalogService, properties);

        scheduler.onApplicationReady();

        assertThat(taskScheduler.invocationCount).isZero();
        assertThat((Object) scheduler.scheduledFuture()).isNull();
    }

    @Test
    void syncsOnlyEnabledRepositories() {
        RecordingTaskScheduler taskScheduler = new RecordingTaskScheduler();
        RepositoryCatalogService repositoryCatalogService = mock(RepositoryCatalogService.class);
        when(repositoryCatalogService.listEnabledSyncRepositories()).thenReturn(List.of(
                new RepositoryDefinition().setId("repo-enabled").setEnabled(true),
                new RepositoryDefinition().setId("repo-enabled-2").setEnabled(true)
        ));

        RepositoryAutoSyncScheduler scheduler = new RepositoryAutoSyncScheduler(taskScheduler, repositoryCatalogService, new AppProperties());

        scheduler.syncAllEnabledRepositories();

        verify(repositoryCatalogService).syncRepository("repo-enabled");
        verify(repositoryCatalogService).syncRepository("repo-enabled-2");
    }

    @Test
    void continuesWhenSingleRepositorySyncFails() {
        RecordingTaskScheduler taskScheduler = new RecordingTaskScheduler();
        RepositoryCatalogService repositoryCatalogService = mock(RepositoryCatalogService.class);
        when(repositoryCatalogService.listEnabledSyncRepositories()).thenReturn(List.of(
                new RepositoryDefinition().setId("repo-1").setEnabled(true),
                new RepositoryDefinition().setId("repo-2").setEnabled(true)
        ));
        when(repositoryCatalogService.syncRepository("repo-1")).thenThrow(new IllegalStateException("boom"));
        when(repositoryCatalogService.syncRepository("repo-2")).thenReturn(new RepositoryDefinition().setId("repo-2"));

        RepositoryAutoSyncScheduler scheduler = new RepositoryAutoSyncScheduler(taskScheduler, repositoryCatalogService, new AppProperties());

        scheduler.syncAllEnabledRepositories();

        verify(repositoryCatalogService, times(1)).syncRepository("repo-1");
        verify(repositoryCatalogService, times(1)).syncRepository("repo-2");
    }

    @Test
    void skipsHttpRepositoriesThroughDiscoveryFilter() {
        RecordingTaskScheduler taskScheduler = new RecordingTaskScheduler();
        RepositoryCatalogService repositoryCatalogService = mock(RepositoryCatalogService.class);
        when(repositoryCatalogService.listEnabledSyncRepositories()).thenReturn(List.of(
                new RepositoryDefinition().setId("repo-enabled").setEnabled(true)
        ));

        RepositoryAutoSyncScheduler scheduler = new RepositoryAutoSyncScheduler(taskScheduler, repositoryCatalogService, new AppProperties());

        scheduler.syncAllEnabledRepositories();

        verify(repositoryCatalogService).syncRepository("repo-enabled");
        verify(repositoryCatalogService, never()).syncRepository("http-repo");
    }

    @Test
    void rejectsNonPositiveInterval() {
        RecordingTaskScheduler taskScheduler = new RecordingTaskScheduler();
        RepositoryCatalogService repositoryCatalogService = mock(RepositoryCatalogService.class);
        AppProperties properties = new AppProperties();
        properties.getRepositories().setAutoSyncIntervalSeconds(0);

        assertThatThrownBy(() -> new RepositoryAutoSyncScheduler(taskScheduler, repositoryCatalogService, properties))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("app.repositories.auto-sync-interval-seconds 必须大于 0");
    }

    private static final class RecordingTaskScheduler implements TaskScheduler {
        private final ScheduledFuture<?> future = mock(ScheduledFuture.class);
        private int invocationCount;
        private Duration period;

        @Override
        public ScheduledFuture<?> schedule(Runnable task, org.springframework.scheduling.Trigger trigger) {
            throw new UnsupportedOperationException();
        }

        @Override
        public ScheduledFuture<?> schedule(Runnable task, Instant startTime) {
            throw new UnsupportedOperationException();
        }

        @Override
        public ScheduledFuture<?> scheduleAtFixedRate(Runnable task, Instant startTime, Duration period) {
            this.invocationCount++;
            this.period = period;
            return future;
        }

        @Override
        public ScheduledFuture<?> scheduleAtFixedRate(Runnable task, Duration period) {
            throw new UnsupportedOperationException();
        }

        @Override
        public ScheduledFuture<?> scheduleWithFixedDelay(Runnable task, Instant startTime, Duration delay) {
            throw new UnsupportedOperationException();
        }

        @Override
        public ScheduledFuture<?> scheduleWithFixedDelay(Runnable task, Duration delay) {
            throw new UnsupportedOperationException();
        }

        @Override
        public ScheduledFuture<?> schedule(Runnable task, java.util.Date startTime) {
            throw new UnsupportedOperationException();
        }

        @Override
        public ScheduledFuture<?> scheduleAtFixedRate(Runnable task, java.util.Date startTime, long period) {
            throw new UnsupportedOperationException();
        }

        @Override
        public ScheduledFuture<?> scheduleAtFixedRate(Runnable task, long period) {
            throw new UnsupportedOperationException();
        }

        @Override
        public ScheduledFuture<?> scheduleWithFixedDelay(Runnable task, java.util.Date startTime, long delay) {
            throw new UnsupportedOperationException();
        }

        @Override
        public ScheduledFuture<?> scheduleWithFixedDelay(Runnable task, long delay) {
            throw new UnsupportedOperationException();
        }
    }
}
