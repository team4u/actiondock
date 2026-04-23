package org.team4u.scriptflow.storage.jpa.adapter;

import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.ExecutionStatus;
import org.team4u.scriptflow.domain.model.ErrorDetail;
import org.team4u.scriptflow.domain.model.ExecutionLogEntry;
import org.team4u.scriptflow.domain.model.SubmitMode;
import org.team4u.scriptflow.domain.model.ExecutionTriggerSource;
import org.team4u.scriptflow.domain.port.ExecutionRepository;
import org.team4u.scriptflow.domain.port.JsonCodec;
import org.team4u.scriptflow.storage.jpa.entity.ExecutionEntity;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataExecutionEntityRepository;

import java.util.List;
import java.util.Optional;

/**
 * JPA 执行记录仓储适配器，将领域层 ExecutionRepository 端口适配到 JPA 实现。
 *
 * @author jay.wu
 */
public class JpaExecutionRepositoryAdapter implements ExecutionRepository {
    private final SpringDataExecutionEntityRepository repository;
    private final JsonCodec jsonCodec;

    public JpaExecutionRepositoryAdapter(SpringDataExecutionEntityRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public ExecutionRecord save(ExecutionRecord record) {
        return toDomain(repository.save(toEntity(record)));
    }

    @Override
    public Optional<ExecutionRecord> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<ExecutionRecord> findByScriptId(String scriptId) {
        return repository.findByScriptIdOrderByCreatedAtDesc(scriptId).stream().map(this::toDomain).toList();
    }

    @Override
    public List<ExecutionRecord> findAll() {
        return repository.findAll().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    @Override
    public void deleteByScriptId(String scriptId) {
        repository.deleteAllByScriptId(scriptId);
    }

    private ExecutionEntity toEntity(ExecutionRecord record) {
        ExecutionEntity entity = new ExecutionEntity();
        entity.setId(record.getId());
        entity.setScriptId(record.getScriptId());
        entity.setStatus(record.getStatus().name());
        entity.setSubmitMode(record.getSubmitMode().name());
        entity.setTriggerSource(record.getTriggerSource().name());
        entity.setScheduleId(record.getScheduleId());
        entity.setInputJson(jsonCodec.write(record.getInput()));
        entity.setOutputJson(jsonCodec.write(record.getOutput()));
        entity.setLogsJson(jsonCodec.write(record.getLogs()));
        entity.setErrorMessage(record.getErrorMessage());
        entity.setErrorType(record.getErrorDetail() == null ? null : record.getErrorDetail().getType());
        entity.setErrorStackTrace(record.getErrorDetail() == null ? null : record.getErrorDetail().getStackTrace());
        entity.setCreatedAt(record.getCreatedAt());
        entity.setStartedAt(record.getStartedAt());
        entity.setFinishedAt(record.getFinishedAt());
        return entity;
    }

    private ExecutionRecord toDomain(ExecutionEntity entity) {
        return new ExecutionRecord()
                .setId(entity.getId())
                .setScriptId(entity.getScriptId())
                .setStatus(ExecutionStatus.valueOf(entity.getStatus()))
                .setSubmitMode(SubmitMode.valueOf(entity.getSubmitMode()))
                .setTriggerSource(entity.getTriggerSource() == null
                        ? ExecutionTriggerSource.MANUAL
                        : ExecutionTriggerSource.valueOf(entity.getTriggerSource()))
                .setScheduleId(entity.getScheduleId())
                .setInput(jsonCodec.readMap(entity.getInputJson()))
                .setOutput(jsonCodec.readMap(entity.getOutputJson()))
                .setLogs(jsonCodec.readList(entity.getLogsJson(), ExecutionLogEntry.class))
                .setErrorMessage(entity.getErrorMessage())
                .setErrorDetail(toErrorDetail(entity))
                .setCreatedAt(entity.getCreatedAt())
                .setStartedAt(entity.getStartedAt())
                .setFinishedAt(entity.getFinishedAt());
    }

    private ErrorDetail toErrorDetail(ExecutionEntity entity) {
        if (entity.getErrorType() == null && entity.getErrorStackTrace() == null) {
            return null;
        }
        return new ErrorDetail()
                .setType(entity.getErrorType())
                .setStackTrace(entity.getErrorStackTrace());
    }
}
