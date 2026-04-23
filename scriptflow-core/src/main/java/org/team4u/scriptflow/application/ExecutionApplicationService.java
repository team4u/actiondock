package org.team4u.scriptflow.application;

import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.ExecutionLogEntry;
import org.team4u.scriptflow.domain.model.ExecutionLogLevel;
import org.team4u.scriptflow.domain.model.ExecutionStatus;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptExecutionContext;
import org.team4u.scriptflow.domain.model.SubmitMode;
import org.team4u.scriptflow.domain.model.ExecutionTriggerSource;
import org.team4u.scriptflow.domain.port.ExecutionRepository;
import org.team4u.scriptflow.domain.port.ScriptEngine;
import org.team4u.scriptflow.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executor;

/**
 * 执行应用服务，提供脚本执行的提交、查询和管理能力。
 * <p>
 * 支持同步和异步两种提交模式，自动进行输入参数校验，
 * 并通过日志收集器在执行过程中持续记录执行日志。
 *
 * @author jay.wu
 */
public class ExecutionApplicationService {
    private final ScriptRepository scriptRepository;
    private final ExecutionRepository executionRepository;
    private final ScriptEngine scriptEngine;
    private final Executor executor;
    private final ScriptSchemaSupport scriptSchemaSupport;
    private final ConfigValueApplicationService configValueApplicationService;

    public ExecutionApplicationService(ScriptRepository scriptRepository,
                                       ExecutionRepository executionRepository,
                                       ScriptEngine scriptEngine,
                                       Executor executor) {
        this(scriptRepository, executionRepository, scriptEngine, executor, ConfigValueApplicationService.disabled());
    }

    public ExecutionApplicationService(ScriptRepository scriptRepository,
                                       ExecutionRepository executionRepository,
                                       ScriptEngine scriptEngine,
                                       Executor executor,
                                       ConfigValueApplicationService configValueApplicationService) {
        this.scriptRepository = scriptRepository;
        this.executionRepository = executionRepository;
        this.scriptEngine = scriptEngine;
        this.executor = executor;
        this.scriptSchemaSupport = new ScriptSchemaSupport();
        this.configValueApplicationService = configValueApplicationService == null
                ? ConfigValueApplicationService.disabled()
                : configValueApplicationService;
    }

    public ExecutionRecord execute(String scriptId, Map<String, Object> input, SubmitMode submitMode) {
        ScriptDefinition scriptDefinition = getScript(scriptId);
        return execute(scriptDefinition, input, submitMode, ExecutionTriggerSource.MANUAL, null);
    }

    public ExecutionRecord executePublished(String scriptId, Map<String, Object> input, SubmitMode submitMode) {
        ScriptDefinition scriptDefinition = getPublishedScript(scriptId);
        return execute(scriptDefinition, input, submitMode, ExecutionTriggerSource.MANUAL, null);
    }

    public ExecutionRecord executePublished(String scriptId,
                                            Map<String, Object> input,
                                            SubmitMode submitMode,
                                            ExecutionTriggerSource triggerSource,
                                            String scheduleId) {
        ScriptDefinition scriptDefinition = getPublishedScript(scriptId);
        return execute(scriptDefinition, input, submitMode, triggerSource, scheduleId);
    }

    private ExecutionRecord execute(ScriptDefinition scriptDefinition,
                                    Map<String, Object> input,
                                    SubmitMode submitMode,
                                    ExecutionTriggerSource triggerSource,
                                    String scheduleId) {
        Map<String, Object> payload = configValueApplicationService.resolveMap(input);
        scriptSchemaSupport.validateInput(scriptDefinition.getId(), payload, scriptDefinition.getInputSchema());

        ExecutionRecord record = new ExecutionRecord()
                .setId(UUID.randomUUID().toString())
                .setScriptId(scriptDefinition.getId())
                .setSubmitMode(submitMode == null ? SubmitMode.SYNC : submitMode)
                .setTriggerSource(triggerSource)
                .setScheduleId(scheduleId)
                .setInput(payload)
                .setCreatedAt(LocalDateTime.now());

        if (record.getSubmitMode() == SubmitMode.ASYNC) {
            record.setStatus(ExecutionStatus.PENDING);
            executionRepository.save(record);
            executor.execute(() -> run(scriptDefinition, record));
            return record;
        }

        return run(scriptDefinition, record);
    }

    private ScriptDefinition getScript(String scriptId) {
        return scriptRepository.findById(scriptId)
                .orElseThrow(() -> new IllegalArgumentException("脚本不存在: " + scriptId));
    }

    private ScriptDefinition getPublishedScript(String scriptId) {
        ScriptDefinition definition = getScript(scriptId);
        if (definition.getPublishedSnapshot() == null) {
            throw new IllegalArgumentException("脚本未发布: " + scriptId);
        }
        return definition.toPublishedDefinition();
    }

    private ExecutionRecord run(ScriptDefinition definition, ExecutionRecord record) {
        ExecutionLogCollector logCollector = new ExecutionLogCollector(record);
        try {
            record.setStatus(ExecutionStatus.RUNNING);
            record.setStartedAt(LocalDateTime.now());
            executionRepository.save(record);

            Object result = scriptEngine.execute(
                    definition,
                    record.getInput(),
                    new ScriptExecutionContext()
                            .setExecutionId(record.getId())
                            .setSubmitMode(record.getSubmitMode())
                            .setConfig(configValueApplicationService.snapshot())
                            .setLogger(logCollector::append)
            );
            return logCollector.completeSuccess(toMap(result));
        } catch (Exception ex) {
            return logCollector.completeFailure(ex);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> toMap(Object result) {
        if (result == null) {
            return new LinkedHashMap<>();
        }
        if (result instanceof Map<?, ?> map) {
            Map<String, Object> values = new LinkedHashMap<>();
            map.forEach((k, v) -> values.put(String.valueOf(k), v));
            return values;
        }
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("result", result);
        return values;
    }

    public ExecutionRecord get(String id) {
        return executionRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("执行记录不存在: " + id));
    }

    public List<ExecutionRecord> list(String scriptId) {
        if (scriptId == null || scriptId.isBlank()) {
            return executionRepository.findAll();
        }
        return executionRepository.findByScriptId(scriptId);
    }

    public void delete(String id) {
        ExecutionRecord record = executionRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("执行记录不存在: " + id));
        ensureExecutionDeletable(record);
        executionRepository.deleteById(id);
    }

    public void clear(String scriptId) {
        if (scriptId == null || scriptId.isBlank()) {
            throw new IllegalArgumentException("scriptId 不能为空");
        }

        List<ExecutionRecord> records = executionRepository.findByScriptId(scriptId);
        records.forEach(this::ensureExecutionDeletable);
        executionRepository.deleteByScriptId(scriptId);
    }

    private void ensureExecutionDeletable(ExecutionRecord record) {
        if (record.getStatus() == ExecutionStatus.PENDING || record.getStatus() == ExecutionStatus.RUNNING) {
            throw new IllegalArgumentException("执行进行中，无法删除");
        }
    }

    private final class ExecutionLogCollector {
        private final ExecutionRecord record;
        private final Object monitor = new Object();

        private ExecutionLogCollector(ExecutionRecord record) {
            this.record = record;
        }

        private void append(ExecutionLogLevel level, String message) {
            synchronized (monitor) {
                record.getLogs().add(new ExecutionLogEntry()
                        .setLevel(level)
                        .setMessage(message)
                        .setCreatedAt(LocalDateTime.now()));
                executionRepository.save(record);
            }
        }

        private ExecutionRecord completeSuccess(Map<String, Object> output) {
            synchronized (monitor) {
                record.setOutput(output);
                record.setErrorMessage(null);
                record.setErrorDetail(null);
                record.setStatus(ExecutionStatus.SUCCESS);
                record.setFinishedAt(LocalDateTime.now());
                return executionRepository.save(record);
            }
        }

        private ExecutionRecord completeFailure(Exception exception) {
            synchronized (monitor) {
                record.setStatus(ExecutionStatus.FAILED);
                record.setErrorMessage(ErrorDetailSupport.summarize(exception));
                record.setErrorDetail(ErrorDetailSupport.describe(exception));
                record.setFinishedAt(LocalDateTime.now());
                return executionRepository.save(record);
            }
        }
    }
}
