package org.team4u.actiondock.schedule;

import org.junit.jupiter.api.Test;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.Trigger;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.ScheduleApplicationService;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.model.ExecutionSubmissionMetadata;
import org.team4u.actiondock.domain.model.ExecutionTriggerSource;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ScheduledFuture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ScriptScheduleDispatcherTest {

    @Test
    void canceledLastExecutionDoesNotBlockNextDispatch() {
        Fixture fixture = new Fixture(ExecutionStatus.CANCELED);

        fixture.dispatcher.refreshAll();
        fixture.taskScheduler.runScheduledTask();

        assertThat(fixture.executionRepository.findByScheduleId("schedule-1"))
                .extracting(ExecutionRecord::getStatus)
                .contains(ExecutionStatus.SUCCESS);
        assertThat(fixture.scheduleRepository.findById("schedule-1").orElseThrow().getLastExecutionId())
                .isNotEqualTo("last-exec");
    }

    @Test
    void runningLastExecutionBlocksNextDispatch() {
        Fixture fixture = new Fixture(ExecutionStatus.RUNNING);

        fixture.dispatcher.refreshAll();
        fixture.taskScheduler.runScheduledTask();

        assertThat(fixture.executionRepository.findByScheduleId("schedule-1"))
                .extracting(ExecutionRecord::getId)
                .containsExactly("last-exec");
        assertThat(fixture.scheduleRepository.findById("schedule-1").orElseThrow().getLastExecutionId())
                .isEqualTo("last-exec");
    }

    private static final class Fixture {
        private final RecordingTaskScheduler taskScheduler = new RecordingTaskScheduler();
        private final InMemoryScriptRepository scriptRepository = new InMemoryScriptRepository();
        private final InMemoryScriptScheduleRepository scheduleRepository = new InMemoryScriptScheduleRepository();
        private final InMemoryExecutionRepository executionRepository = new InMemoryExecutionRepository();
        private final ScriptScheduleDispatcher dispatcher;

        private Fixture(ExecutionStatus lastExecutionStatus) {
            scriptRepository.save(new ScriptDefinition()
                    .setId("script-1")
                    .setPublishedRevision(new PublishedScriptRevision()
                            .setId("rev-1")
                            .setScriptId("script-1")
                            .setVersion(1)
                            .setPublishedAt(LocalDateTime.now())
                            .setSource("return [:]")));
            scheduleRepository.save(new ScriptSchedule()
                    .setId("schedule-1")
                    .setScriptId("script-1")
                    .setName("Schedule")
                    .setCronExpression("0 * * * * *")
                    .setEnabled(true)
                    .setLastExecutionId("last-exec"));
            executionRepository.save(record("last-exec", "script-1", "schedule-1", lastExecutionStatus));
            ExecutionApplicationService executionService = new ExecutionApplicationService(
                    scriptRepository,
                    executionRepository,
                    mock(ScriptEngine.class),
                    Runnable::run
            );
            dispatcher = new ScriptScheduleDispatcher(
                    taskScheduler,
                    new ScheduleApplicationService(scheduleRepository, scriptRepository, expression -> {
                    }),
                    executionService,
                    executionRepository,
                    scriptRepository
            );
        }
    }

    private static ExecutionRecord record(String id, String scriptId, String scheduleId, ExecutionStatus status) {
        return new ExecutionRecord()
                .setId(id)
                .setScriptId(scriptId)
                .setScheduleId(scheduleId)
                .setTriggerSource(ExecutionTriggerSource.SCHEDULED)
                .setSubmitMode(SubmitMode.ASYNC)
                .setStatus(status)
                .setCreatedAt(LocalDateTime.now());
    }

    private static final class RecordingTaskScheduler implements TaskScheduler {
        private Runnable task;

        void runScheduledTask() {
            task.run();
        }

        @Override
        public ScheduledFuture<?> schedule(Runnable task, Trigger trigger) {
            this.task = task;
            return mock(ScheduledFuture.class);
        }

        @Override
        public ScheduledFuture<?> schedule(Runnable task, Instant startTime) {
            return null;
        }

        @Override
        public ScheduledFuture<?> scheduleAtFixedRate(Runnable task, Instant startTime, Duration period) {
            return null;
        }

        @Override
        public ScheduledFuture<?> scheduleAtFixedRate(Runnable task, Duration period) {
            return null;
        }

        @Override
        public ScheduledFuture<?> scheduleWithFixedDelay(Runnable task, Instant startTime, Duration delay) {
            return null;
        }

        @Override
        public ScheduledFuture<?> scheduleWithFixedDelay(Runnable task, Duration delay) {
            return null;
        }
    }

    private static final class InMemoryScriptRepository implements ScriptRepository {
        private final Map<String, ScriptDefinition> store = new LinkedHashMap<>();

        @Override
        public ScriptDefinition save(ScriptDefinition definition) {
            store.put(definition.getId(), definition);
            return definition;
        }

        @Override
        public Optional<ScriptDefinition> findById(String id) {
            return Optional.ofNullable(store.get(id));
        }

        @Override
        public List<ScriptDefinition> findAll() {
            return new ArrayList<>(store.values());
        }

        @Override
        public void deleteById(String id) {
            store.remove(id);
        }
    }

    private static final class InMemoryScriptScheduleRepository implements ScriptScheduleRepository {
        private final Map<String, ScriptSchedule> store = new LinkedHashMap<>();

        @Override
        public ScriptSchedule save(ScriptSchedule schedule) {
            store.put(schedule.getId(), schedule.copy());
            return schedule;
        }

        @Override
        public Optional<ScriptSchedule> findById(String id) {
            return Optional.ofNullable(store.get(id)).map(ScriptSchedule::copy);
        }

        @Override
        public List<ScriptSchedule> findAll() {
            return store.values().stream().map(ScriptSchedule::copy).toList();
        }

        @Override
        public List<ScriptSchedule> findByScriptId(String scriptId) {
            return store.values().stream()
                    .filter(schedule -> scriptId.equals(schedule.getScriptId()))
                    .map(ScriptSchedule::copy)
                    .toList();
        }

        @Override
        public List<ScriptSchedule> findEnabled() {
            return store.values().stream()
                    .filter(ScriptSchedule::isEnabled)
                    .map(ScriptSchedule::copy)
                    .toList();
        }

        @Override
        public void deleteById(String id) {
            store.remove(id);
        }

        @Override
        public void deleteByScriptId(String scriptId) {
            store.entrySet().removeIf(entry -> scriptId.equals(entry.getValue().getScriptId()));
        }
    }

    private static final class InMemoryExecutionRepository implements ExecutionRepository {
        private final Map<String, ExecutionRecord> store = new LinkedHashMap<>();

        @Override
        public ExecutionRecord save(ExecutionRecord record) {
            store.put(record.getId(), copy(record));
            return record;
        }

        @Override
        public Optional<ExecutionRecord> findById(String id) {
            return Optional.ofNullable(store.get(id)).map(InMemoryExecutionRepository::copy);
        }

        @Override
        public List<ExecutionRecord> findByScriptId(String scriptId) {
            return store.values().stream()
                    .filter(record -> scriptId.equals(record.getScriptId()))
                    .map(InMemoryExecutionRepository::copy)
                    .toList();
        }

        @Override
        public List<ExecutionRecord> findAll() {
            return store.values().stream().map(InMemoryExecutionRepository::copy).toList();
        }

        @Override
        public void deleteById(String id) {
            store.remove(id);
        }

        @Override
        public List<ExecutionRecord> findByScheduleId(String scheduleId) {
            return store.values().stream()
                    .filter(record -> scheduleId.equals(record.getScheduleId()))
                    .map(InMemoryExecutionRepository::copy)
                    .toList();
        }

        @Override
        public void deleteByScriptId(String scriptId) {
            store.entrySet().removeIf(entry -> scriptId.equals(entry.getValue().getScriptId()));
        }

        @Override
        public void keepLatest(String scriptId, int limit) {
        }

        private static ExecutionRecord copy(ExecutionRecord source) {
            return new ExecutionRecord()
                    .setId(source.getId())
                    .setScriptId(source.getScriptId())
                    .setStatus(source.getStatus())
                    .setSubmitMode(source.getSubmitMode())
                    .setTriggerSource(source.getTriggerSource())
                    .setScheduleId(source.getScheduleId())
                    .setInput(source.getInput())
                    .setOutput(source.getOutput())
                    .setLogs(source.getLogs())
                    .setErrorMessage(source.getErrorMessage())
                    .setErrorDetail(source.getErrorDetail())
                    .setCreatedAt(source.getCreatedAt())
                    .setStartedAt(source.getStartedAt())
                    .setFinishedAt(source.getFinishedAt());
        }
    }
}
