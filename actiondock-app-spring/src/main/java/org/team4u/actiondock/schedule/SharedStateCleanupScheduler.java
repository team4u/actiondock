package org.team4u.actiondock.schedule;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.TaskScheduler;
import org.team4u.actiondock.application.SharedStateApplicationService;
import org.team4u.actiondock.config.AppProperties;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ScheduledFuture;

/**
 * 共享状态过期自动清理调度器。
 * <p>
 * 应用启动后按固定间隔清理所有已过期的共享状态条目。
 *
 * @author jay.wu
 */
public class SharedStateCleanupScheduler {

    private static final Logger log = LoggerFactory.getLogger(SharedStateCleanupScheduler.class);

    private final TaskScheduler taskScheduler;
    private final SharedStateApplicationService sharedStateService;
    private final int purgeIntervalSeconds;
    private ScheduledFuture<?> scheduledFuture;

    public SharedStateCleanupScheduler(TaskScheduler taskScheduler,
                                       SharedStateApplicationService sharedStateService,
                                       AppProperties properties) {
        this.taskScheduler = taskScheduler;
        this.sharedStateService = sharedStateService;
        this.purgeIntervalSeconds = properties.getSharedState().getPurgeIntervalSeconds();
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        Duration interval = Duration.ofSeconds(purgeIntervalSeconds);
        scheduledFuture = taskScheduler.scheduleAtFixedRate(this::purge, Instant.now().plus(interval), interval);
        log.info("Shared state cleanup task started, purge interval: {}s", purgeIntervalSeconds);
    }

    private void purge() {
        try {
            long count = sharedStateService.purgeExpired(null);
            if (count > 0) {
                log.info("已清理 {} 条过期共享状态", count);
            }
        } catch (IllegalStateException exception) {
            // 共享状态服务未启用，取消定时任务
            cancel();
        } catch (Exception exception) {
            log.error("共享状态过期清理失败", exception);
        }
    }

    private void cancel() {
        if (scheduledFuture != null) {
            scheduledFuture.cancel(false);
            scheduledFuture = null;
        }
    }
}
