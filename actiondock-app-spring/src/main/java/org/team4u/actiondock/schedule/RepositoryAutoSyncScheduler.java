package org.team4u.actiondock.schedule;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.TaskScheduler;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.repository.RepositoryCatalogService;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.ScheduledFuture;

/**
 * 仓库自动同步调度器。
 * <p>
 * 应用启动后按固定间隔同步所有已启用的仓库，复用现有手工同步逻辑。
 *
 * @author jay.wu
 */
public class RepositoryAutoSyncScheduler {
    private static final Logger log = LoggerFactory.getLogger(RepositoryAutoSyncScheduler.class);

    private final TaskScheduler taskScheduler;
    private final RepositoryCatalogService repositoryCatalogService;
    private final boolean autoSyncEnabled;
    private final int autoSyncIntervalSeconds;
    private ScheduledFuture<?> scheduledFuture;

    public RepositoryAutoSyncScheduler(TaskScheduler taskScheduler,
                                       RepositoryCatalogService repositoryCatalogService,
                                       AppProperties properties) {
        this.taskScheduler = taskScheduler;
        this.repositoryCatalogService = repositoryCatalogService;
        this.autoSyncEnabled = properties.getRepositories().isAutoSyncEnabled();
        this.autoSyncIntervalSeconds = properties.getRepositories().getAutoSyncIntervalSeconds();
        if (autoSyncIntervalSeconds <= 0) {
            throw new IllegalArgumentException("app.repositories.auto-sync-interval-seconds 必须大于 0");
        }
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        if (!autoSyncEnabled) {
            log.info("Repository auto-sync disabled");
            return;
        }
        Duration interval = Duration.ofSeconds(autoSyncIntervalSeconds);
        scheduledFuture = taskScheduler.scheduleAtFixedRate(this::syncAllEnabledRepositories, Instant.now().plus(interval), interval);
        log.info("Repository auto-sync task started, interval: {}s", autoSyncIntervalSeconds);
    }

    void syncAllEnabledRepositories() {
        List<RepositoryDefinition> repositories = repositoryCatalogService.listEnabledSyncRepositories();
        if (repositories.isEmpty()) {
            return;
        }
        int successCount = 0;
        int failureCount = 0;
        log.info("Repository auto-sync started, repositories: {}", repositories.size());
        for (RepositoryDefinition repository : repositories) {
            try {
                repositoryCatalogService.syncRepository(repository.getId());
                successCount++;
            } catch (Exception exception) {
                failureCount++;
                log.error("Repository auto-sync failed: {}", repository.getId(), exception);
            }
        }
        log.info("Repository auto-sync finished, success: {}, failed: {}", successCount, failureCount);
    }

    ScheduledFuture<?> scheduledFuture() {
        return scheduledFuture;
    }
}
