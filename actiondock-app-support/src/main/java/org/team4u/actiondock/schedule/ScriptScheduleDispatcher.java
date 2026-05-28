package org.team4u.actiondock.schedule;

import org.team4u.actiondock.common.NormalizeUtils;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.support.CronTrigger;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.ScheduleApplicationService;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.model.ExecutionTriggerSource;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

/**
 * 脚本调度分发器，基于 Spring TaskScheduler 管理 Cron 定时任务的注册和执行。
 * <p>
 * 应用启动时自动加载所有已启用的调度，并在调度变更时动态刷新任务。
 *
 * @author jay.wu
 */
public class ScriptScheduleDispatcher {
    private static final Logger log = LoggerFactory.getLogger(ScriptScheduleDispatcher.class);

    private final TaskScheduler taskScheduler;
    private final ScheduleApplicationService scheduleApplicationService;
    private final ExecutionApplicationService executionApplicationService;
    private final ExecutionRepository executionRepository;
    private final ScriptRepository scriptRepository;
    private final Map<String, ScheduledFuture<?>> scheduledTasks = new ConcurrentHashMap<>();
    private final Map<String, String> scheduleScriptIndex = new ConcurrentHashMap<>();

    public ScriptScheduleDispatcher(TaskScheduler taskScheduler,
                                    ScheduleApplicationService scheduleApplicationService,
                                    ExecutionApplicationService executionApplicationService,
                                    ExecutionRepository executionRepository,
                                    ScriptRepository scriptRepository) {
        this.taskScheduler = taskScheduler;
        this.scheduleApplicationService = scheduleApplicationService;
        this.executionApplicationService = executionApplicationService;
        this.executionRepository = executionRepository;
        this.scriptRepository = scriptRepository;
    }

    /**
     * 应用启动就绪时自动加载所有已启用的调度任务。
     */
    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        refreshAll();
    }

    /**
     * 刷新全部调度任务。
     * <p>
     * 取消当前所有已注册的任务，重新加载所有已启用的调度并注册。
     */
    public synchronized void refreshAll() {
        Set<String> scheduleIds = Set.copyOf(scheduledTasks.keySet());
        scheduleIds.forEach(this::synchronizedCancelSchedule);
        scheduleApplicationService.listEnabled().forEach(this::registerSchedule);
    }

    /**
     * 刷新指定脚本关联的调度任务。
     * <p>
     * 取消该脚本下的所有现有调度，重新加载并注册已启用的调度。
     *
     * @param scriptId 脚本 ID
     */
    public synchronized void refreshScript(String scriptId) {
        scheduleScriptIndex.entrySet().stream()
                .filter(entry -> entry.getValue().equals(scriptId))
                .map(Map.Entry::getKey)
                .toList()
                .forEach(this::synchronizedCancelSchedule);
        List<ScriptSchedule> schedules;
        try {
            schedules = scheduleApplicationService.list(scriptId);
        } catch (IllegalArgumentException exception) {
            return;
        }
        schedules.stream()
                .filter(ScriptSchedule::isEnabled)
                .forEach(this::registerSchedule);
    }

    private void registerSchedule(ScriptSchedule schedule) {
        synchronizedCancelSchedule(schedule.getId());
        ScheduledFuture<?> future = taskScheduler.schedule(
                () -> dispatch(schedule.getId()),
                new CronTrigger(schedule.getCronExpression())
        );
        if (future != null) {
            scheduledTasks.put(schedule.getId(), future);
            scheduleScriptIndex.put(schedule.getId(), schedule.getScriptId());
        }
    }

    private void dispatch(String scheduleId) {
        try {
            ScriptSchedule schedule = scheduleApplicationService.getById(scheduleId);
            if (!schedule.isEnabled()) {
                synchronizedCancelSchedule(scheduleId);
                return;
            }

            ScriptDefinition script = scriptRepository.findById(schedule.getScriptId()).orElse(null);
            if (script == null || !script.hasPublishedRevision()) {
                synchronizedCancelSchedule(scheduleId);
                return;
            }
            if (hasActiveExecution(schedule.getLastExecutionId())) {
                return;
            }

            LocalDateTime now = LocalDateTime.now();
            ExecutionRecord record = executionApplicationService.executePublished(
                    schedule.getScriptId(),
                    schedule.getInput(),
                    SubmitMode.ASYNC,
                    ExecutionTriggerSource.SCHEDULED,
                    schedule.getId()
            );
            scheduleApplicationService.markTriggered(schedule.getId(), record.getId(), now);
        } catch (IllegalArgumentException exception) {
            log.warn("Skip invalid schedule {}", scheduleId, exception);
            synchronizedCancelSchedule(scheduleId);
        } catch (Exception exception) {
            log.error("Schedule dispatch failed: {}", scheduleId, exception);
        }
    }

    private boolean hasActiveExecution(String executionId) {
        if (NormalizeUtils.isBlank(executionId)) {
            return false;
        }
        return executionRepository.findById(executionId)
                .map(ExecutionRecord::getStatus)
                .filter(status -> status == ExecutionStatus.PENDING || status == ExecutionStatus.RUNNING)
                .isPresent();
    }

    private synchronized void synchronizedCancelSchedule(String scheduleId) {
        ScheduledFuture<?> future = scheduledTasks.remove(scheduleId);
        if (future != null) {
            future.cancel(false);
        }
        scheduleScriptIndex.remove(scheduleId);
    }
}
