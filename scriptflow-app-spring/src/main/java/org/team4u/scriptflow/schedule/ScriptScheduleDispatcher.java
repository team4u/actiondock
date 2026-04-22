package org.team4u.scriptflow.schedule;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.support.CronTrigger;
import org.team4u.scriptflow.application.ExecutionApplicationService;
import org.team4u.scriptflow.application.ScheduleApplicationService;
import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.ExecutionStatus;
import org.team4u.scriptflow.domain.model.ExecutionTriggerSource;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptSchedule;
import org.team4u.scriptflow.domain.model.SubmitMode;
import org.team4u.scriptflow.domain.port.ExecutionRepository;
import org.team4u.scriptflow.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

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

    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        refreshAll();
    }

    public synchronized void refreshAll() {
        Set<String> scheduleIds = Set.copyOf(scheduledTasks.keySet());
        scheduleIds.forEach(this::cancelSchedule);
        scheduleApplicationService.listEnabled().forEach(this::registerSchedule);
    }

    public synchronized void refreshScript(String scriptId) {
        scheduleScriptIndex.entrySet().stream()
                .filter(entry -> entry.getValue().equals(scriptId))
                .map(Map.Entry::getKey)
                .toList()
                .forEach(this::cancelSchedule);
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
        cancelSchedule(schedule.getId());
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
                cancelSchedule(scheduleId);
                return;
            }

            ScriptDefinition script = scriptRepository.findById(schedule.getScriptId()).orElse(null);
            if (script == null || script.getPublishedSnapshot() == null) {
                cancelSchedule(scheduleId);
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
            cancelSchedule(scheduleId);
        } catch (Exception exception) {
            log.error("Schedule dispatch failed: {}", scheduleId, exception);
        }
    }

    private boolean hasActiveExecution(String executionId) {
        if (executionId == null || executionId.isBlank()) {
            return false;
        }
        return executionRepository.findById(executionId)
                .map(ExecutionRecord::getStatus)
                .filter(status -> status == ExecutionStatus.PENDING || status == ExecutionStatus.RUNNING)
                .isPresent();
    }

    private synchronized void cancelSchedule(String scheduleId) {
        ScheduledFuture<?> future = scheduledTasks.remove(scheduleId);
        if (future != null) {
            future.cancel(false);
        }
        scheduleScriptIndex.remove(scheduleId);
    }
}
