package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;

import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.model.ErrorDetail;
import org.team4u.actiondock.domain.model.ExecutionLogEntry;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.domain.model.ExecutionTriggerSource;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.storage.jpa.entity.ExecutionEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataExecutionEntityRepository;

import java.util.List;
import java.util.Optional;

/**
 * JPA 执行记录仓储适配器，将领域层 ExecutionRepository 端口适配到 JPA 实现。
 *
 * @author jay.wu
 */
@Component
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
    public List<ExecutionRecord> findByScheduleId(String scheduleId) {
        return repository.findByScheduleIdOrderByCreatedAtDesc(scheduleId).stream().map(this::toDomain).toList();
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

    /**
     * 将执行记录领域对象转换为 JPA 实体。
     * <p>
     * 输入、输出、日志使用 JSON 序列化，错误详情拆分为类型和堆栈字段。
     *
     * @param record 执行记录领域对象
     * @return JPA 实体
     */
    private ExecutionEntity toEntity(ExecutionRecord record) {
        ExecutionEntity entity = new ExecutionEntity();
        entity.setId(record.getId());
        entity.setScriptId(record.getScriptId());
        entity.setStatus(record.getStatus().name());
        entity.setSubmitMode(record.getSubmitMode().name());
        entity.setTriggerSource(record.getTriggerSource().name());
        entity.setScheduleId(record.getScheduleId());
        entity.setAgentRunId(record.getAgentRunId());
        entity.setAgentStepId(record.getAgentStepId());
        entity.setWebhookId(record.getWebhookId());
        entity.setInputJson(jsonCodec.write(record.getInput()));
        entity.setOutputJson(jsonCodec.write(record.getOutput()));
        entity.setLogsJson(jsonCodec.write(record.getLogs()));
        entity.setErrorMessage(record.getErrorMessage());
        ErrorDetail errorDetail = record.getErrorDetail();
        entity.setErrorType(errorDetail == null ? null : errorDetail.getType());
        entity.setErrorStackTrace(errorDetail == null ? null : errorDetail.getStackTrace());
        entity.setErrorDetailsJson(errorDetail == null ? null : jsonCodec.write(errorDetail.getDetails()));
        entity.setCreatedAt(record.getCreatedAt());
        entity.setStartedAt(record.getStartedAt());
        entity.setFinishedAt(record.getFinishedAt());
        return entity;
    }

    /**
     * 将 JPA 实体转换为执行记录领域对象。
     * <p>
     * JSON 字段反序列化为输入输出 Map 和日志列表，错误字段重建为 ErrorDetail。
     *
     * @param entity JPA 实体
     * @return 执行记录领域对象
     */
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
                .setAgentRunId(entity.getAgentRunId())
                .setAgentStepId(entity.getAgentStepId())
                .setWebhookId(entity.getWebhookId())
                .setInput(jsonCodec.readMap(entity.getInputJson()))
                .setOutput(jsonCodec.readMap(entity.getOutputJson()))
                .setLogs(jsonCodec.readList(entity.getLogsJson(), ExecutionLogEntry.class))
                .setErrorMessage(entity.getErrorMessage())
                .setErrorDetail(toErrorDetail(entity))
                .setCreatedAt(entity.getCreatedAt())
                .setStartedAt(entity.getStartedAt())
                .setFinishedAt(entity.getFinishedAt());
    }

    /**
     * 从 JPA 实体的错误字段重建错误详情对象。
     *
     * @param entity JPA 实体
     * @return 错误详情，错误类型和堆栈均为空时返回 null
     */
    private ErrorDetail toErrorDetail(ExecutionEntity entity) {
        if (entity.getErrorType() == null && entity.getErrorStackTrace() == null) {
            return null;
        }
        return new ErrorDetail()
                .setType(entity.getErrorType())
                .setStackTrace(entity.getErrorStackTrace())
                .setDetails(jsonCodec.readMap(entity.getErrorDetailsJson()));
    }
}
