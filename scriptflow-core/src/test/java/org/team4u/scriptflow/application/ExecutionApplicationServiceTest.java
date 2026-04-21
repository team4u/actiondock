package org.team4u.scriptflow.application;

import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.ExecutionStatus;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.SubmitMode;
import org.team4u.scriptflow.domain.port.ExecutionRepository;
import org.team4u.scriptflow.domain.port.ScriptEngine;
import org.team4u.scriptflow.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ExecutionApplicationServiceTest {
    private final InMemoryScriptRepository scriptRepository = new InMemoryScriptRepository();
    private final RecordingExecutionRepository executionRepository = new RecordingExecutionRepository();
    private final ScriptEngine scriptEngine = mock(ScriptEngine.class);

    @Test
    void executeRunsSynchronouslyAndPersistsSuccessState() {
        scriptRepository.save(new ScriptDefinition().setId("script-1").setSource("return [:]"));
        when(scriptEngine.execute(any(), any())).thenReturn(Map.of("message", "Hello"));
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );

        ExecutionRecord record = service.execute("script-1", Map.of("name", "Alice"), null);

        assertThat(record.getSubmitMode()).isEqualTo(SubmitMode.SYNC);
        assertThat(record.getStatus()).isEqualTo(ExecutionStatus.SUCCESS);
        assertThat(record.getInput()).containsEntry("name", "Alice");
        assertThat(record.getOutput()).containsEntry("message", "Hello");
        assertThat(record.getCreatedAt()).isNotNull();
        assertThat(record.getStartedAt()).isNotNull();
        assertThat(record.getFinishedAt()).isNotNull();
        assertThat(executionRepository.savedSnapshots)
                .extracting(ExecutionRecord::getStatus)
                .containsExactly(ExecutionStatus.RUNNING, ExecutionStatus.SUCCESS);
    }

    @Test
    void executeWrapsScalarResultsIntoResultField() {
        scriptRepository.save(new ScriptDefinition().setId("script-1").setSource("return 42"));
        when(scriptEngine.execute(any(), any())).thenReturn(42);
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );

        ExecutionRecord record = service.execute("script-1", null, SubmitMode.SYNC);

        assertThat(record.getOutput()).containsEntry("result", 42);
    }

    @Test
    void executeCapturesFailures() {
        scriptRepository.save(new ScriptDefinition().setId("script-1").setSource("throw new RuntimeException()"));
        when(scriptEngine.execute(any(), any())).thenThrow(new IllegalStateException("boom"));
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );

        ExecutionRecord record = service.execute("script-1", Map.of(), SubmitMode.SYNC);

        assertThat(record.getStatus()).isEqualTo(ExecutionStatus.FAILED);
        assertThat(record.getErrorMessage()).isEqualTo("boom");
        assertThat(record.getFinishedAt()).isNotNull();
        assertThat(executionRepository.savedSnapshots)
                .extracting(ExecutionRecord::getStatus)
                .containsExactly(ExecutionStatus.RUNNING, ExecutionStatus.FAILED);
    }

    @Test
    void executeSchedulesAsyncWorkAndReturnsPendingRecordImmediately() {
        scriptRepository.save(new ScriptDefinition().setId("script-1").setSource("return [:]"));
        when(scriptEngine.execute(any(), any())).thenReturn(Map.of("message", "done"));
        ControllableExecutor executor = new ControllableExecutor();
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                executor
        );

        ExecutionRecord record = service.execute("script-1", Map.of("name", "Alice"), SubmitMode.ASYNC);

        assertThat(record.getStatus()).isEqualTo(ExecutionStatus.PENDING);
        assertThat(executionRepository.savedSnapshots)
                .extracting(ExecutionRecord::getStatus)
                .containsExactly(ExecutionStatus.PENDING);
        assertThat(executor.tasks).hasSize(1);

        executor.runAll();

        assertThat(record.getStatus()).isEqualTo(ExecutionStatus.SUCCESS);
        assertThat(executionRepository.savedSnapshots)
                .extracting(ExecutionRecord::getStatus)
                .containsExactly(ExecutionStatus.PENDING, ExecutionStatus.RUNNING, ExecutionStatus.SUCCESS);
    }

    @Test
    void listUsesScriptFilterOnlyWhenProvided() {
        scriptRepository.save(new ScriptDefinition().setId("script-1"));
        scriptRepository.save(new ScriptDefinition().setId("script-2"));
        when(scriptEngine.execute(eq(scriptRepository.findById("script-1").orElseThrow()), any())).thenReturn(Map.of("value", 1));
        when(scriptEngine.execute(eq(scriptRepository.findById("script-2").orElseThrow()), any())).thenReturn(Map.of("value", 2));
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );
        service.execute("script-1", Map.of(), SubmitMode.SYNC);
        service.execute("script-2", Map.of(), SubmitMode.SYNC);

        assertThat(service.list("script-1")).hasSize(1);
        assertThat(service.list(" ")).hasSize(2);
    }

    @Test
    void getThrowsWhenExecutionMissing() {
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );

        assertThatThrownBy(() -> service.get("missing"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Execution not found: missing");
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

    private static final class RecordingExecutionRepository implements ExecutionRepository {
        private final Map<String, ExecutionRecord> store = new LinkedHashMap<>();
        private final List<ExecutionRecord> savedSnapshots = new ArrayList<>();

        @Override
        public ExecutionRecord save(ExecutionRecord record) {
            ExecutionRecord snapshot = copy(record);
            savedSnapshots.add(snapshot);
            store.put(snapshot.getId(), snapshot);
            return record;
        }

        @Override
        public Optional<ExecutionRecord> findById(String id) {
            return Optional.ofNullable(store.get(id)).map(RecordingExecutionRepository::copy);
        }

        @Override
        public List<ExecutionRecord> findByScriptId(String scriptId) {
            return store.values().stream()
                    .filter(record -> scriptId.equals(record.getScriptId()))
                    .map(RecordingExecutionRepository::copy)
                    .toList();
        }

        @Override
        public List<ExecutionRecord> findAll() {
            return store.values().stream().map(RecordingExecutionRepository::copy).toList();
        }

        private static ExecutionRecord copy(ExecutionRecord source) {
            return new ExecutionRecord()
                    .setId(source.getId())
                    .setScriptId(source.getScriptId())
                    .setStatus(source.getStatus())
                    .setSubmitMode(source.getSubmitMode())
                    .setInput(new LinkedHashMap<>(source.getInput()))
                    .setOutput(new LinkedHashMap<>(source.getOutput()))
                    .setErrorMessage(source.getErrorMessage())
                    .setCreatedAt(source.getCreatedAt())
                    .setStartedAt(source.getStartedAt())
                    .setFinishedAt(source.getFinishedAt());
        }
    }

    private static final class ControllableExecutor implements Executor {
        private final List<Runnable> tasks = new ArrayList<>();

        @Override
        public void execute(Runnable command) {
            tasks.add(command);
        }

        void runAll() {
            tasks.forEach(Runnable::run);
            tasks.clear();
        }
    }
}
