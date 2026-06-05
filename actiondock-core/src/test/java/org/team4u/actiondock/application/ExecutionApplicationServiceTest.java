package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.ErrorDetail;
import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.model.ExecutionLogEntry;
import org.team4u.actiondock.domain.model.ExecutionLogLevel;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;

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
        when(scriptEngine.execute(any(), any(), any())).thenReturn(Map.of("message", "Hello"));
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
        when(scriptEngine.execute(any(), any(), any())).thenReturn(42);
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
    void executeRejectsInvalidInputAgainstSchema() {
        scriptRepository.save(new ScriptDefinition()
                .setId("script-1")
                .setInputSchema(Map.of(
                        "type", "object",
                        "required", List.of("name"),
                        "properties", Map.of(
                                "name", Map.of("type", "string", "title", "Name")
                        )
                )));
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );

        assertThatThrownBy(() -> service.execute("script-1", Map.of(), SubmitMode.SYNC))
                .isInstanceOf(InvalidExecutionInputException.class)
                .hasMessage("脚本 script-1 输入参数校验失败: Name 必填");
        assertThat(executionRepository.savedSnapshots).isEmpty();
    }

    @Test
    void executeNormalizesCharSequenceInputsBeforeValidation() {
        scriptRepository.save(new ScriptDefinition()
                .setId("script-1")
                .setInputSchema(Map.of(
                        "type", "object",
                        "required", List.of("tableName"),
                        "properties", Map.of(
                                "tableName", Map.of("type", "string", "title", "Table Name")
                        )
                )));
        when(scriptEngine.execute(any(), any(), any())).thenAnswer(invocation -> {
            Map<String, Object> input = invocation.getArgument(1);
            assertThat(input.get("tableName")).isEqualTo("cap_cbs.table_a").isInstanceOf(String.class);
            return Map.of("ok", true);
        });
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );

        ExecutionRecord record = service.execute("script-1", Map.of("tableName", new StringBuilder("cap_cbs.table_a")), SubmitMode.SYNC);

        assertThat(record.getStatus()).isEqualTo(ExecutionStatus.SUCCESS);
        assertThat(record.getInput().get("tableName")).isEqualTo("cap_cbs.table_a").isInstanceOf(String.class);
    }

    @Test
    void executeSkipsValidationWhenSchemaMissing() {
        scriptRepository.save(new ScriptDefinition().setId("script-1").setSource("return [:]"));
        when(scriptEngine.execute(any(), any(), any())).thenReturn(Map.of("ok", true));
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );

        ExecutionRecord record = service.execute("script-1", Map.of("free", "form"), SubmitMode.SYNC);

        assertThat(record.getStatus()).isEqualTo(ExecutionStatus.SUCCESS);
        assertThat(record.getInput()).containsEntry("free", "form");
    }

    @Test
    void executeResolvesConfigReferencesAndInjectsConfigSnapshot() {
        scriptRepository.save(new ScriptDefinition()
                .setId("script-1")
                .setInputSchema(Map.of(
                        "type", "object",
                        "properties", Map.of(
                                "url", Map.of("type", "string")
                        )
                )));
        InMemoryConfigValueRepository configRepository = new InMemoryConfigValueRepository();
        ConfigValueApplicationService configService = new ConfigValueApplicationService(configRepository);
        configService.create(new ConfigValue().setKey("host").setValue("api.example.com"));
        configService.create(new ConfigValue().setKey("base_url").setValue("https://${config.host}/v1"));
        when(scriptEngine.execute(any(), any(), any())).thenAnswer(invocation -> {
            Map<String, Object> input = invocation.getArgument(1);
            ScriptExecutionContext context = invocation.getArgument(2);
            assertThat(input).containsEntry("url", "https://api.example.com/v1");
            assertThat(context.getConfig()).containsEntry("base_url", "https://api.example.com/v1");
            assertThat(context.getScriptStack()).containsExactly("script-1");
            return Map.of("ok", true);
        });
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run,
                configService
        );

        ExecutionRecord record = service.execute("script-1", Map.of("url", "${config.base_url}"), SubmitMode.SYNC);

        assertThat(record.getInput()).containsEntry("url", "https://api.example.com/v1");
        assertThat(record.getStatus()).isEqualTo(ExecutionStatus.SUCCESS);
    }

    @Test
    void executeCapturesFailures() {
        scriptRepository.save(new ScriptDefinition().setId("script-1").setSource("throw new RuntimeException()"));
        when(scriptEngine.execute(any(), any(), any())).thenThrow(new IllegalStateException("boom"));
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );

        ExecutionRecord record = service.execute("script-1", Map.of(), SubmitMode.SYNC);

        assertThat(record.getStatus()).isEqualTo(ExecutionStatus.FAILED);
        assertThat(record.getErrorMessage()).isEqualTo("boom");
        assertThat(record.getErrorDetail()).isNotNull();
        assertThat(record.getErrorDetail().getType()).isEqualTo(IllegalStateException.class.getName());
        assertThat(record.getErrorDetail().getStackTrace()).contains("IllegalStateException: boom");
        assertThat(record.getFinishedAt()).isNotNull();
        assertThat(executionRepository.savedSnapshots)
                .extracting(ExecutionRecord::getStatus)
                .containsExactly(ExecutionStatus.RUNNING, ExecutionStatus.FAILED);
    }

    @Test
    void executePersistsLogsBeforeCompletion() {
        scriptRepository.save(new ScriptDefinition().setId("script-1").setSource("return [:]"));
        when(scriptEngine.execute(any(), any(), any())).thenAnswer(invocation -> {
            ScriptExecutionContext context = invocation.getArgument(2);
            context.log(ExecutionLogLevel.INFO, "start");
            context.log(ExecutionLogLevel.WARN, "watch-out");
            return Map.of("message", "Hello");
        });
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );

        ExecutionRecord record = service.execute("script-1", Map.of(), SubmitMode.SYNC);

        assertThat(record.getLogs())
                .extracting(ExecutionLogEntry::getMessage)
                .containsExactly("start", "watch-out");
        assertThat(executionRepository.savedSnapshots)
                .extracting(snapshot -> snapshot.getLogs().size())
                .containsExactly(0, 1, 2, 2);
    }

    @Test
    void executeKeepsLogsWhenExecutionFails() {
        scriptRepository.save(new ScriptDefinition().setId("script-1").setSource("throw new RuntimeException()"));
        when(scriptEngine.execute(any(), any(), any())).thenAnswer(invocation -> {
            ScriptExecutionContext context = invocation.getArgument(2);
            context.log(ExecutionLogLevel.ERROR, "about to fail");
            throw new IllegalStateException("boom");
        });
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );

        ExecutionRecord record = service.execute("script-1", Map.of(), SubmitMode.SYNC);

        assertThat(record.getStatus()).isEqualTo(ExecutionStatus.FAILED);
        assertThat(record.getLogs())
                .extracting(ExecutionLogEntry::getMessage)
                .containsExactly("about to fail");
        assertThat(executionRepository.savedSnapshots.get(executionRepository.savedSnapshots.size() - 1).getLogs())
                .extracting(ExecutionLogEntry::getLevel)
                .containsExactly(ExecutionLogLevel.ERROR);
    }

    @Test
    void executeSchedulesAsyncWorkAndReturnsPendingRecordImmediately() {
        scriptRepository.save(new ScriptDefinition().setId("script-1").setSource("return [:]"));
        when(scriptEngine.execute(any(), any(), any())).thenReturn(Map.of("message", "done"));
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
    void executePublishedRunsPublishedSnapshotInsteadOfDraft() {
        scriptRepository.save(new ScriptDefinition()
                .setId("script-1")
                .setName("Draft")
                .setType(ScriptType.PYTHON)
                .setSource("return {'message': 'draft'}")
                .setPublishedRevision(new PublishedScriptRevision()
                        .setId("rev-1")
                        .setScriptId("script-1")
                        .setVersion(1)
                        .setPublishedAt(LocalDateTime.of(2026, 4, 30, 10, 0))
                        .setName("Live")
                        .setType(ScriptType.GROOVY)
                        .setSource("return [message: 'live']")
                        .setInputSchema(Map.of("type", "object"))
                        .setOutputSchema(Map.of("type", "object"))));
        when(scriptEngine.execute(any(), any(), any())).thenReturn(Map.of("message", "live"));
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );

        ExecutionRecord record = service.executePublished("script-1", Map.of("name", "Alice"), SubmitMode.SYNC);

        assertThat(record.getStatus()).isEqualTo(ExecutionStatus.SUCCESS);
        assertThat(executionRepository.savedSnapshots)
                .extracting(ExecutionRecord::getScriptId)
                .containsOnly("script-1");
        assertThat(scriptRepository.findById("script-1").orElseThrow().getSource()).isEqualTo("return {'message': 'draft'}");
    }

    @Test
    void executePublishedRejectsUnpublishedScript() {
        scriptRepository.save(new ScriptDefinition().setId("script-1"));
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );

        assertThatThrownBy(() -> service.executePublished("script-1", Map.of(), SubmitMode.SYNC))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("脚本未发布: script-1");
    }

    @Test
    void listUsesScriptFilterOnlyWhenProvided() {
        scriptRepository.save(new ScriptDefinition().setId("script-1"));
        scriptRepository.save(new ScriptDefinition().setId("script-2"));
        when(scriptEngine.execute(eq(scriptRepository.findById("script-1").orElseThrow()), any(), any())).thenReturn(Map.of("value", 1));
        when(scriptEngine.execute(eq(scriptRepository.findById("script-2").orElseThrow()), any(), any())).thenReturn(Map.of("value", 2));
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );
        service.execute("script-1", Map.of(), SubmitMode.SYNC);
        service.execute("script-2", Map.of(), SubmitMode.SYNC);

        assertThat(service.list("script-1")).hasSize(1);
        assertThatThrownBy(() -> service.list(" "))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("scriptId 不能为空");
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
                .hasMessage("执行记录不存在: missing");
    }

    @Test
    void deleteRemovesCompletedExecution() {
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );
        executionRepository.save(record("exec-1", "script-1", ExecutionStatus.SUCCESS));

        service.delete("exec-1");

        assertThat(executionRepository.findById("exec-1")).isEmpty();
    }

    @Test
    void deleteRejectsActiveExecution() {
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );
        executionRepository.save(record("exec-1", "script-1", ExecutionStatus.RUNNING));

        assertThatThrownBy(() -> service.delete("exec-1"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("执行进行中，无法删除");
    }

    @Test
    void cancelMarksPendingExecutionAsCanceled() {
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );
        executionRepository.save(record("exec-1", "script-1", ExecutionStatus.PENDING));

        ExecutionRecord record = service.cancel("exec-1");

        assertThat(record.getStatus()).isEqualTo(ExecutionStatus.CANCELED);
        assertThat(record.getErrorMessage()).isEqualTo("执行已取消");
        assertThat(record.getFinishedAt()).isNotNull();
    }

    @Test
    void cancelMarksRunningExecutionAsCanceled() {
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );
        executionRepository.save(record("exec-1", "script-1", ExecutionStatus.RUNNING));

        ExecutionRecord record = service.cancel("exec-1");

        assertThat(record.getStatus()).isEqualTo(ExecutionStatus.CANCELED);
        assertThat(executionRepository.findById("exec-1").orElseThrow().getStatus()).isEqualTo(ExecutionStatus.CANCELED);
    }

    @Test
    void cancelRejectsCompletedExecution() {
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );
        executionRepository.save(record("exec-1", "script-1", ExecutionStatus.SUCCESS));

        assertThatThrownBy(() -> service.cancel("exec-1"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("执行已结束，无法取消");
    }

    @Test
    void canceledAsyncExecutionIsNotStarted() {
        scriptRepository.save(new ScriptDefinition().setId("script-1").setSource("return [:]"));
        when(scriptEngine.execute(any(), any(), any())).thenReturn(Map.of("message", "done"));
        ControllableExecutor executor = new ControllableExecutor();
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                executor
        );

        ExecutionRecord record = service.execute("script-1", Map.of(), SubmitMode.ASYNC);
        service.cancel(record.getId());
        executor.runAll();

        assertThat(executionRepository.findById(record.getId()).orElseThrow().getStatus()).isEqualTo(ExecutionStatus.CANCELED);
        assertThat(executionRepository.savedSnapshots)
                .extracting(ExecutionRecord::getStatus)
                .containsExactly(ExecutionStatus.PENDING, ExecutionStatus.CANCELED);
    }

    @Test
    void canceledRunningExecutionIsNotOverwrittenBySuccess() {
        scriptRepository.save(new ScriptDefinition().setId("script-1").setSource("return [:]"));
        ExecutionApplicationService[] holder = new ExecutionApplicationService[1];
        when(scriptEngine.execute(any(), any(), any())).thenAnswer(invocation -> {
            ScriptExecutionContext context = invocation.getArgument(2);
            holder[0].cancel(context.getExecutionId());
            return Map.of("message", "done");
        });
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );
        holder[0] = service;

        ExecutionRecord record = service.execute("script-1", Map.of(), SubmitMode.SYNC);

        assertThat(record.getStatus()).isEqualTo(ExecutionStatus.CANCELED);
        assertThat(executionRepository.findById(record.getId()).orElseThrow().getStatus()).isEqualTo(ExecutionStatus.CANCELED);
        assertThat(executionRepository.savedSnapshots)
                .extracting(ExecutionRecord::getStatus)
                .containsExactly(ExecutionStatus.RUNNING, ExecutionStatus.CANCELED);
    }

    @Test
    void clearRemovesExecutionsForSingleScriptOnly() {
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );
        executionRepository.save(record("exec-1", "script-1", ExecutionStatus.SUCCESS));
        executionRepository.save(record("exec-2", "script-1", ExecutionStatus.FAILED));
        executionRepository.save(record("exec-3", "script-2", ExecutionStatus.SUCCESS));

        service.clear("script-1");

        assertThat(executionRepository.findById("exec-1")).isEmpty();
        assertThat(executionRepository.findById("exec-2")).isEmpty();
        assertThat(executionRepository.findById("exec-3")).isPresent();
    }

    @Test
    void clearRejectsBlankScriptId() {
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );

        assertThatThrownBy(() -> service.clear(" "))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("scriptId 不能为空");
    }

    @Test
    void clearRejectsWhenActiveExecutionExists() {
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );
        executionRepository.save(record("exec-1", "script-1", ExecutionStatus.PENDING));

        assertThatThrownBy(() -> service.clear("script-1"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("执行进行中，无法删除");
    }

    @Test
    void executeCleansUpExecutionRecords() {
        scriptRepository.save(new ScriptDefinition().setId("script-cleanup").setMaxExecutionRecords(2));
        when(scriptEngine.execute(any(), any(), any())).thenReturn(new LinkedHashMap<>());
        ExecutionApplicationService service = new ExecutionApplicationService(
                scriptRepository,
                executionRepository,
                scriptEngine,
                Runnable::run
        );

        service.execute("script-cleanup", null, SubmitMode.SYNC);
        service.execute("script-cleanup", null, SubmitMode.SYNC);
        service.execute("script-cleanup", null, SubmitMode.SYNC);

        List<ExecutionRecord> records = executionRepository.findByScriptId("script-cleanup");
        assertThat(records).hasSize(2);
    }

    private static ExecutionRecord record(String id, String scriptId, ExecutionStatus status) {
        return new ExecutionRecord()
                .setId(id)
                .setScriptId(scriptId)
                .setStatus(status)
                .setSubmitMode(SubmitMode.SYNC)
                .setInput(new LinkedHashMap<>())
                .setOutput(new LinkedHashMap<>())
                .setCreatedAt(LocalDateTime.of(2024, 1, 2, 3, 4));
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

    private static final class InMemoryConfigValueRepository implements ConfigValueRepository {
        private final Map<String, ConfigValue> store = new LinkedHashMap<>();

        @Override
        public ConfigValue save(ConfigValue configValue) {
            ConfigValue copy = new ConfigValue()
                    .setKey(configValue.getKey())
                    .setValue(configValue.getValue())
                    .setDescription(configValue.getDescription())
                    .setCreatedAt(configValue.getCreatedAt())
                    .setUpdatedAt(configValue.getUpdatedAt());
            store.put(copy.getKey(), copy);
            return copy;
        }

        @Override
        public Optional<ConfigValue> findByKey(String key) {
            return Optional.ofNullable(store.get(key));
        }

        @Override
        public List<ConfigValue> findAll() {
            return new ArrayList<>(store.values());
        }

        @Override
        public void deleteByKey(String key) {
            store.remove(key);
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

        @Override
        public List<ExecutionRecord> findByScheduleId(String scheduleId) {
            return store.values().stream()
                    .filter(record -> scheduleId.equals(record.getScheduleId()))
                    .map(RecordingExecutionRepository::copy)
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

        @Override
        public void keepLatest(String scriptId, int limit) {
            List<ExecutionRecord> records = store.values().stream()
                    .filter(record -> scriptId.equals(record.getScriptId()))
                    .sorted((r1, r2) -> {
                        if (r1.getCreatedAt() == null) return 1;
                        if (r2.getCreatedAt() == null) return -1;
                        return r2.getCreatedAt().compareTo(r1.getCreatedAt());
                    })
                    .toList();
            if (records.size() > limit) {
                records.subList(limit, records.size()).forEach(record -> store.remove(record.getId()));
            }
        }

        private static ExecutionRecord copy(ExecutionRecord source) {
            return new ExecutionRecord()
                    .setId(source.getId())
                    .setScriptId(source.getScriptId())
                    .setStatus(source.getStatus())
                    .setSubmitMode(source.getSubmitMode())
                    .setTriggerSource(source.getTriggerSource())
                    .setScheduleId(source.getScheduleId())
                    .setInput(new LinkedHashMap<>(source.getInput()))
                    .setOutput(new LinkedHashMap<>(source.getOutput()))
                    .setLogs(source.getLogs().stream()
                            .map(log -> new ExecutionLogEntry()
                                    .setLevel(log.getLevel())
                                    .setMessage(log.getMessage())
                                    .setCreatedAt(log.getCreatedAt()))
                            .toList())
                    .setErrorMessage(source.getErrorMessage())
                    .setErrorDetail(copy(source.getErrorDetail()))
                    .setCreatedAt(source.getCreatedAt())
                    .setStartedAt(source.getStartedAt())
                    .setFinishedAt(source.getFinishedAt());
        }

        private static ErrorDetail copy(ErrorDetail source) {
            if (source == null) {
                return null;
            }
            return new ErrorDetail()
                    .setType(source.getType())
                    .setStackTrace(source.getStackTrace());
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
