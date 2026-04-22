package org.team4u.scriptflow.application;

import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.ExecutionStatus;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptExecutionContext;
import org.team4u.scriptflow.domain.model.SubmitMode;
import org.team4u.scriptflow.domain.port.ExecutionRepository;
import org.team4u.scriptflow.domain.port.ScriptEngine;
import org.team4u.scriptflow.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executor;

public class ExecutionApplicationService {
    private final ScriptRepository scriptRepository;
    private final ExecutionRepository executionRepository;
    private final ScriptEngine scriptEngine;
    private final Executor executor;
    private final ScriptSchemaSupport scriptSchemaSupport;

    public ExecutionApplicationService(ScriptRepository scriptRepository,
                                       ExecutionRepository executionRepository,
                                       ScriptEngine scriptEngine,
                                       Executor executor) {
        this.scriptRepository = scriptRepository;
        this.executionRepository = executionRepository;
        this.scriptEngine = scriptEngine;
        this.executor = executor;
        this.scriptSchemaSupport = new ScriptSchemaSupport();
    }

    public ExecutionRecord execute(String scriptId, Map<String, Object> input, SubmitMode submitMode) {
        ScriptDefinition scriptDefinition = getScript(scriptId);
        return execute(scriptDefinition, input, submitMode);
    }

    public ExecutionRecord executePublished(String scriptId, Map<String, Object> input, SubmitMode submitMode) {
        ScriptDefinition scriptDefinition = getPublishedScript(scriptId);
        return execute(scriptDefinition, input, submitMode);
    }

    private ExecutionRecord execute(ScriptDefinition scriptDefinition, Map<String, Object> input, SubmitMode submitMode) {
        Map<String, Object> payload = input == null ? new LinkedHashMap<>() : new LinkedHashMap<>(input);
        scriptSchemaSupport.validateInput(scriptDefinition.getId(), payload, scriptDefinition.getInputSchema());

        ExecutionRecord record = new ExecutionRecord()
                .setId(UUID.randomUUID().toString())
                .setScriptId(scriptDefinition.getId())
                .setSubmitMode(submitMode == null ? SubmitMode.SYNC : submitMode)
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
                .orElseThrow(() -> new IllegalArgumentException("Script not found: " + scriptId));
    }

    private ScriptDefinition getPublishedScript(String scriptId) {
        ScriptDefinition definition = getScript(scriptId);
        if (definition.getPublishedSnapshot() == null) {
            throw new IllegalArgumentException("Script not published: " + scriptId);
        }
        return definition.toPublishedDefinition();
    }

    private ExecutionRecord run(ScriptDefinition definition, ExecutionRecord record) {
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
            );
            record.setOutput(toMap(result));
            record.setStatus(ExecutionStatus.SUCCESS);
            record.setFinishedAt(LocalDateTime.now());
            return executionRepository.save(record);
        } catch (Exception ex) {
            record.setStatus(ExecutionStatus.FAILED);
            record.setErrorMessage(ex.getMessage());
            record.setFinishedAt(LocalDateTime.now());
            return executionRepository.save(record);
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
                .orElseThrow(() -> new IllegalArgumentException("Execution not found: " + id));
    }

    public List<ExecutionRecord> list(String scriptId) {
        if (scriptId == null || scriptId.isBlank()) {
            return executionRepository.findAll();
        }
        return executionRepository.findByScriptId(scriptId);
    }

    public void delete(String id) {
        ExecutionRecord record = executionRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Execution not found: " + id));
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
            throw new IllegalArgumentException("执行仍在进行中，暂不支持删除");
        }
    }
}
