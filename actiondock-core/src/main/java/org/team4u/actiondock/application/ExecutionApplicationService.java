package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionSubmissionMetadata;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.domain.model.ExecutionTriggerSource;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.time.LocalDateTime;
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
    private static final String EXECUTION_CANCELED_MESSAGE = "执行已取消";

    private final ScriptRepository scriptRepository;
    private final ExecutionRepository executionRepository;
    private final ScriptEngine scriptEngine;
    private final Executor executor;
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
        this.configValueApplicationService = configValueApplicationService == null
                ? ConfigValueApplicationService.disabled()
                : configValueApplicationService;
    }

    /**
     * 执行指定脚本（使用当前版本）。
     * <p>
     * 触发来源默认为手动执行（MANUAL），不关联调度。
     *
     * @param scriptId   脚本 ID
     * @param input      输入参数
     * @param submitMode 提交模式（SYNC 或 ASYNC）
     * @return 执行记录
     * @throws IllegalArgumentException 如果脚本不存在或输入参数校验失败
     */
    public ExecutionRecord execute(String scriptId, Map<String, Object> input, SubmitMode submitMode) {
        ScriptDefinition scriptDefinition = getScript(scriptId);
        return execute(scriptDefinition, input, submitMode, ExecutionSubmissionMetadata.manual());
    }

    /**
     * 执行指定脚本的已发布版本。
     * <p>
     * 仅使用脚本的发布快照进行执行，触发来源默认为手动执行。
     *
     * @param scriptId   脚本 ID
     * @param input      输入参数
     * @param submitMode 提交模式（SYNC 或 ASYNC）
     * @return 执行记录
     * @throws IllegalArgumentException 如果脚本不存在、未发布或输入参数校验失败
     */
    public ExecutionRecord executePublished(String scriptId, Map<String, Object> input, SubmitMode submitMode) {
        ScriptDefinition scriptDefinition = getPublishedScript(scriptId);
        return execute(scriptDefinition, input, submitMode, ExecutionSubmissionMetadata.manual());
    }

    /**
     * 执行指定脚本的已发布版本，并指定触发来源和关联调度。
     * <p>
     * 用于定时调度等自动化触发场景，可记录触发来源和关联的调度 ID。
     *
     * @param scriptId      脚本 ID
     * @param input         输入参数
     * @param submitMode    提交模式（SYNC 或 ASYNC）
     * @param triggerSource 触发来源（如 MANUAL、SCHEDULE）
     * @param scheduleId    关联的调度 ID，可为 null
     * @return 执行记录
     * @throws IllegalArgumentException 如果脚本不存在、未发布或输入参数校验失败
     */
    public ExecutionRecord executePublished(String scriptId,
                                            Map<String, Object> input,
                                            SubmitMode submitMode,
                                            ExecutionTriggerSource triggerSource,
                                            String scheduleId) {
        return executePublished(scriptId, input, submitMode, new ExecutionSubmissionMetadata()
                .setTriggerSource(triggerSource)
                .setScheduleId(scheduleId));
    }

    public ExecutionRecord executePublished(String scriptId,
                                            Map<String, Object> input,
                                            SubmitMode submitMode,
                                            ExecutionTriggerSource triggerSource,
                                            String scheduleId,
                                            String agentRunId,
                                            String agentStepId) {
        return executePublished(scriptId, input, submitMode, new ExecutionSubmissionMetadata()
                .setTriggerSource(triggerSource)
                .setScheduleId(scheduleId)
                .setAgentRunId(agentRunId)
                .setAgentStepId(agentStepId));
    }

    public ExecutionRecord executePublished(String scriptId,
                                            Map<String, Object> input,
                                            SubmitMode submitMode,
                                            ExecutionSubmissionMetadata metadata) {
        ScriptDefinition scriptDefinition = getPublishedScript(scriptId);
        return execute(scriptDefinition, input, submitMode, metadata);
    }

    private ExecutionRecord execute(ScriptDefinition scriptDefinition,
                                    Map<String, Object> input,
                                    SubmitMode submitMode,
                                    ExecutionSubmissionMetadata metadata) {
        Map<String, Object> payload = ExecutionInputNormalizer.normalizeMap(
                configValueApplicationService.resolveMap(input)
        );
        ScriptSchemaSupport.validateInput(scriptDefinition.getId(), payload, scriptDefinition.getInputSchema());
        ExecutionSubmissionMetadata executionMetadata = metadata == null ? ExecutionSubmissionMetadata.manual() : metadata;

        ExecutionRecord record = new ExecutionRecord()
                .setId(UUID.randomUUID().toString())
                .setScriptId(scriptDefinition.getId())
                .setSubmitMode(submitMode == null ? SubmitMode.SYNC : submitMode)
                .setTriggerSource(executionMetadata.getTriggerSource())
                .setScheduleId(executionMetadata.getScheduleId())
                .setAgentRunId(executionMetadata.getAgentRunId())
                .setAgentStepId(executionMetadata.getAgentStepId())
                .setWebhookId(executionMetadata.getWebhookId())
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
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.SCRIPT_NOT_FOUND,
                        "脚本不存在: " + scriptId,
                        Map.of("scriptId", scriptId)
                ));
    }

    private ScriptDefinition getPublishedScript(String scriptId) {
        ScriptDefinition definition = getScript(scriptId);
        if (!definition.hasPublishedRevision()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.SCRIPT_NOT_PUBLISHED,
                    "脚本未发布: " + scriptId,
                    Map.of("scriptId", scriptId)
            );
        }
        return definition.toPublishedDefinition();
    }

    private ExecutionRecord run(ScriptDefinition definition, ExecutionRecord record) {
        ExecutionLogCollector logCollector = new ExecutionLogCollector(record, executionRepository);
        try {
            if (isExecutionCanceled(record.getId())) {
                return get(record.getId());
            }
            record.setStatus(ExecutionStatus.RUNNING);
            record.setStartedAt(LocalDateTime.now());
            executionRepository.save(record);

            Object result = scriptEngine.execute(
                    definition,
                    record.getInput(),
                    buildExecutionContext(definition, record, logCollector)
            );
            ExecutionRecord successRecord = logCollector.completeSuccess(MapValueConverter.toResultMap(result));
            cleanUpExecutionRecords(definition.getId(), definition.getMaxExecutionRecords());
            return successRecord;
        } catch (Exception ex) {
            ExecutionRecord failureRecord = logCollector.completeFailure(ex);
            cleanUpExecutionRecords(definition.getId(), definition.getMaxExecutionRecords());
            return failureRecord;
        } catch (Throwable t) {
            markFailedOnFatalError(record, t);
            cleanUpExecutionRecords(definition.getId(), definition.getMaxExecutionRecords());
            throw t;
        }
    }

    private void cleanUpExecutionRecords(String scriptId, Integer maxExecutionRecords) {
        try {
            int limit = maxExecutionRecords != null ? maxExecutionRecords : 1000;
            executionRepository.keepLatest(scriptId, limit);
        } catch (Exception e) {
            System.getLogger(ExecutionApplicationService.class.getName())
                    .log(System.Logger.Level.WARNING, "清理历史执行记录失败, scriptId: " + scriptId, e);
        }
    }

    private ScriptExecutionContext buildExecutionContext(ScriptDefinition definition, ExecutionRecord record,
                                                        ExecutionLogCollector logCollector) {
        return new ScriptExecutionContext()
                .setExecutionId(record.getId())
                .setSubmitMode(record.getSubmitMode())
                .setConfig(configValueApplicationService.snapshot())
                .setScriptStack(List.of(definition.getId()))
                .setLogger(logCollector::append);
    }

    private void markFailedOnFatalError(ExecutionRecord record, Throwable t) {
        try {
            if (isExecutionCanceled(record.getId())) {
                return;
            }
            record.setStatus(ExecutionStatus.FAILED);
            record.setErrorMessage("致命错误: " + t.getClass().getName());
            record.setFinishedAt(LocalDateTime.now());
            executionRepository.save(record);
        } catch (Exception ignored) {
        }
    }

    private boolean isExecutionCanceled(String executionId) {
        return executionRepository.findById(executionId)
                .map(ExecutionRecord::getStatus)
                .filter(status -> status == ExecutionStatus.CANCELED)
                .isPresent();
    }

    /**
     * 根据 ID 查询执行记录。
     *
     * @param id 执行记录 ID
     * @return 执行记录
     * @throws IllegalArgumentException 如果执行记录不存在
     */
    public ExecutionRecord get(String id) {
        return executionRepository.findById(id)
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.EXECUTION_NOT_FOUND,
                        "执行记录不存在: " + id,
                        Map.of("executionId", id)
                ));
    }

    /**
     * 查询指定脚本的所有执行记录。
     *
     * @param scriptId 脚本 ID
     * @return 执行记录列表
     * @throws IllegalArgumentException 如果 scriptId 为空
     */
    public List<ExecutionRecord> list(String scriptId) {
        ApplicationServiceSupport.normalize(scriptId, "scriptId 不能为空");
        return executionRepository.findByScriptId(scriptId);
    }

    /**
     * 查询指定调度的所有执行记录。
     *
     * @param scheduleId 调度 ID
     * @return 执行记录列表
     * @throws IllegalArgumentException 如果 scheduleId 为空
     */
    public List<ExecutionRecord> listByScheduleId(String scheduleId) {
        ApplicationServiceSupport.normalize(scheduleId, "scheduleId 不能为空");
        return executionRepository.findByScheduleId(scheduleId);
    }

    /**
     * 取消执行记录。
     * <p>
     * 仅允许取消仍处于 PENDING 或 RUNNING 的记录。取消后记录进入 CANCELED 终态，
     * 后续后台执行完成时不会覆盖该状态。
     *
     * @param id 执行记录 ID
     * @return 取消后的执行记录
     */
    public ExecutionRecord cancel(String id) {
        ExecutionRecord record = get(id);
        if (!record.isActive()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.EXECUTION_NOT_ACTIVE,
                    "执行已结束，无法取消",
                    Map.of("executionId", record.getId(), "status", record.getStatus().name())
            );
        }
        record.setStatus(ExecutionStatus.CANCELED);
        record.setErrorMessage(EXECUTION_CANCELED_MESSAGE);
        record.setErrorDetail(null);
        record.setFinishedAt(LocalDateTime.now());
        return executionRepository.save(record);
    }

    /**
     * 删除执行记录。
     * <p>
     * 仅允许删除已结束（SUCCESS、FAILED 或 CANCELED）的执行记录，进行中的记录无法删除。
     *
     * @param id 执行记录 ID
     * @throws IllegalArgumentException 如果记录不存在或仍在执行中
     */
    public void delete(String id) {
        ExecutionRecord record = executionRepository.findById(id)
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.EXECUTION_NOT_FOUND,
                        "执行记录不存在: " + id,
                        Map.of("executionId", id)
                ));
        ensureExecutionDeletable(record);
        executionRepository.deleteById(id);
    }

    /**
     * 清除指定脚本的所有执行记录。
     * <p>
     * 仅删除已结束（SUCCESS、FAILED 或 CANCELED）的记录。如果存在进行中的记录，将抛出异常。
     *
     * @param scriptId 脚本 ID
     * @throws IllegalArgumentException 如果 scriptId 为空或存在仍在执行中的记录
     */
    public void clear(String scriptId) {
        ApplicationServiceSupport.normalize(scriptId, "scriptId 不能为空");

        List<ExecutionRecord> records = executionRepository.findByScriptId(scriptId);
        records.forEach(ExecutionApplicationService::ensureExecutionDeletable);
        executionRepository.deleteByScriptId(scriptId);
    }

    private static void ensureExecutionDeletable(ExecutionRecord record) {
        if (record.getStatus() == ExecutionStatus.PENDING || record.getStatus() == ExecutionStatus.RUNNING) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.EXECUTION_IN_PROGRESS,
                    "执行进行中，无法删除",
                    Map.of("executionId", record.getId())
            );
        }
    }
}
