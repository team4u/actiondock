package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.SchemaValueCopier;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.port.ScheduleExpressionValidator;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 调度应用服务，提供脚本定时调度配置的管理能力。
 * <p>
 * 管理调度的创建、启停、删除以及触发记录更新，
 * 确保调度关联的脚本已发布且 Cron 表达式合法。
 *
 * @author jay.wu
 */
public class ScheduleApplicationService {
    private final ScriptScheduleRepository scriptScheduleRepository;
    private final ScriptRepository scriptRepository;
    private final ScheduleExpressionValidator scheduleExpressionValidator;
    private final ConfigValueApplicationService configValueApplicationService;

    public ScheduleApplicationService(ScriptScheduleRepository scriptScheduleRepository,
                                      ScriptRepository scriptRepository,
                                      ScheduleExpressionValidator scheduleExpressionValidator) {
        this(scriptScheduleRepository, scriptRepository, scheduleExpressionValidator, ConfigValueApplicationService.disabled());
    }

    public ScheduleApplicationService(ScriptScheduleRepository scriptScheduleRepository,
                                      ScriptRepository scriptRepository,
                                      ScheduleExpressionValidator scheduleExpressionValidator,
                                      ConfigValueApplicationService configValueApplicationService) {
        this.scriptScheduleRepository = scriptScheduleRepository;
        this.scriptRepository = scriptRepository;
        this.scheduleExpressionValidator = scheduleExpressionValidator;
        this.configValueApplicationService = configValueApplicationService == null
                ? ConfigValueApplicationService.disabled()
                : configValueApplicationService;
    }

    /**
     * 查询指定脚本的所有调度配置。
     *
     * @param scriptId 脚本 ID
     * @return 该脚本关联的调度列表
     * @throws IllegalArgumentException 如果脚本不存在
     */
    public List<ScriptSchedule> list(String scriptId) {
        ensureScriptExists(scriptId);
        return scriptScheduleRepository.findByScriptId(scriptId);
    }

    /**
     * 查询所有调度配置。
     *
     * @return 全部调度列表
     */
    public List<ScriptSchedule> listAll() {
        return scriptScheduleRepository.findAll();
    }

    /**
     * 查询所有已启用的调度配置。
     *
     * @return 已启用的调度列表
     */
    public List<ScriptSchedule> listEnabled() {
        return scriptScheduleRepository.findEnabled();
    }

    /**
     * 根据 ID 获取调度配置。
     *
     * @param scheduleId 调度 ID
     * @return 调度配置
     * @throws IllegalArgumentException 如果调度不存在
     */
    public ScriptSchedule getById(String scheduleId) {
        return scriptScheduleRepository.findById(scheduleId)
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.SCHEDULE_NOT_FOUND,
                        "调度不存在: " + scheduleId,
                        Map.of("scheduleId", scheduleId)
                ));
    }

    /**
     * 获取指定脚本下的调度配置，并校验归属关系。
     *
     * @param scriptId   脚本 ID
     * @param scheduleId 调度 ID
     * @return 调度配置
     * @throws IllegalArgumentException 如果调度不存在或不属于该脚本
     */
    public ScriptSchedule get(String scriptId, String scheduleId) {
        ScriptSchedule schedule = getById(scheduleId);
        ensureScheduleBelongsToScript(schedule, scriptId);
        return schedule;
    }

    /**
     * 保存调度配置（新增或更新）。
     * <p>
     * 要求关联脚本必须已发布。新建时自动生成 ID 和时间戳，
     * 更新时校验调度归属关系并刷新时间戳。
     * 保存前会验证 Cron 表达式合法性，并对解析配置值后的输入参数执行模式校验。
     *
     * @param scriptId 脚本 ID
     * @param schedule 调度配置信息
     * @return 保存后的调度配置
     * @throws IllegalArgumentException 如果脚本未发布、参数为空或校验失败
     */
    public ScriptSchedule save(String scriptId, ScriptSchedule schedule) {
        ScriptDefinition script = ensurePublishedScript(scriptId);
        if (schedule == null) {
            throw new IllegalArgumentException("定时任务不能为空");
        }

        LocalDateTime now = LocalDateTime.now();
        ScriptSchedule target;
        if (schedule.getId() == null || schedule.getId().isBlank()) {
            target = new ScriptSchedule()
                    .setId(UUID.randomUUID().toString())
                    .setCreatedAt(now);
        } else {
            target = getById(schedule.getId());
            ensureScheduleBelongsToScript(target, scriptId);
            ensureEditable(target);
        }

        String name = ApplicationServiceSupport.normalize(schedule.getName(), "定时任务名称不能为空");
        String cronExpression = ApplicationServiceSupport.normalize(schedule.getCronExpression(), "Cron 表达式不能为空");
        scheduleExpressionValidator.validate(cronExpression);

        target.setScriptId(script.getId())
                .setName(name)
                .setCronExpression(cronExpression)
                .setInput(SchemaValueCopier.copyMap(schedule.getInput()))
                .setEnabled(schedule.isEnabled())
                .setUpdatedAt(now);
        ScriptDefinition publishedScript = script.toPublishedDefinition();
        ScriptSchemaSupport.validateInput(script.getId(),
                configValueApplicationService.resolveMap(target.getInput()),
                publishedScript.getInputSchema());
        return scriptScheduleRepository.save(target);
    }

    /**
     * 启用调度配置。
     * <p>
     * 启用前会重新校验 Cron 表达式的合法性，确保调度可正常触发。
     *
     * @param scriptId   脚本 ID
     * @param scheduleId 调度 ID
     * @return 启用后的调度配置
     * @throws IllegalArgumentException 如果脚本未发布、调度不存在或 Cron 表达式不合法
     */
    public ScriptSchedule enable(String scriptId, String scheduleId) {
        ensurePublishedScript(scriptId);
        ScriptSchedule schedule = get(scriptId, scheduleId);
        ensureEditable(schedule);
        scheduleExpressionValidator.validate(schedule.getCronExpression());
        schedule.setEnabled(true).setUpdatedAt(LocalDateTime.now());
        return scriptScheduleRepository.save(schedule);
    }

    /**
     * 根据 ID 启用调度配置，自动解析关联脚本。
     *
     * @param scheduleId 调度 ID
     * @return 启用后的调度配置
     */
    public ScriptSchedule enableByScheduleId(String scheduleId) {
        ScriptSchedule schedule = getById(scheduleId);
        return enable(schedule.getScriptId(), scheduleId);
    }

    /**
     * 禁用调度配置。
     * <p>
     * 禁用后调度将不再被定时触发，但配置仍保留。
     *
     * @param scriptId   脚本 ID
     * @param scheduleId 调度 ID
     * @return 禁用后的调度配置
     * @throws IllegalArgumentException 如果调度不存在或不属于该脚本
     */
    public ScriptSchedule disable(String scriptId, String scheduleId) {
        ScriptSchedule schedule = get(scriptId, scheduleId);
        ensureEditable(schedule);
        schedule.setEnabled(false).setUpdatedAt(LocalDateTime.now());
        return scriptScheduleRepository.save(schedule);
    }

    /**
     * 根据 ID 禁用调度配置，自动解析关联脚本。
     *
     * @param scheduleId 调度 ID
     * @return 禁用后的调度配置
     */
    public ScriptSchedule disableByScheduleId(String scheduleId) {
        ScriptSchedule schedule = getById(scheduleId);
        return disable(schedule.getScriptId(), scheduleId);
    }

    /**
     * 删除指定脚本下的调度配置。
     *
     * @param scriptId   脚本 ID
     * @param scheduleId 调度 ID
     * @throws IllegalArgumentException 如果调度不存在或不属于该脚本
     */
    public void delete(String scriptId, String scheduleId) {
        ScriptSchedule schedule = get(scriptId, scheduleId);
        ensureEditable(schedule);
        scriptScheduleRepository.deleteById(schedule.getId());
    }

    /**
     * 根据 ID 删除调度配置，自动解析关联脚本。
     *
     * @param scheduleId 调度 ID
     */
    public void deleteByScheduleId(String scheduleId) {
        ScriptSchedule schedule = getById(scheduleId);
        delete(schedule.getScriptId(), scheduleId);
    }

    /**
     * 标记调度已被触发，记录触发时间和关联的执行 ID。
     * <p>
     * 由调度引擎在每次成功触发执行后调用。
     *
     * @param scheduleId  调度 ID
     * @param executionId 本次触发产生的执行记录 ID
     * @param triggeredAt 触发时间
     * @return 更新后的调度配置
     * @throws IllegalArgumentException 如果调度不存在
     */
    public ScriptSchedule markTriggered(String scheduleId, String executionId, LocalDateTime triggeredAt) {
        ScriptSchedule schedule = getById(scheduleId);
        schedule.setLastExecutionId(executionId)
                .setLastTriggeredAt(triggeredAt)
                .setUpdatedAt(triggeredAt);
        return scriptScheduleRepository.save(schedule);
    }

    private ScriptDefinition ensurePublishedScript(String scriptId) {
        ScriptDefinition script = ensureScriptExists(scriptId);
        if (!script.hasPublishedRevision()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.SCRIPT_NOT_PUBLISHED,
                    "脚本未发布: " + scriptId,
                    Map.of("scriptId", scriptId)
            );
        }
        return script;
    }

    private ScriptDefinition ensureScriptExists(String scriptId) {
        return scriptRepository.findById(scriptId)
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.SCRIPT_NOT_FOUND,
                        "脚本不存在: " + scriptId,
                        Map.of("scriptId", scriptId)
                ));
    }

    private static void ensureScheduleBelongsToScript(ScriptSchedule schedule, String scriptId) {
        if (!schedule.getScriptId().equals(scriptId)) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.SCHEDULE_SCRIPT_MISMATCH,
                    "调度不属于该脚本: " + schedule.getId(),
                    Map.of("scheduleId", schedule.getId(), "scriptId", scriptId)
            );
        }
    }

    private static void ensureEditable(ScriptSchedule schedule) {
        if (!schedule.isEditable()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.SCHEDULE_NOT_EDITABLE,
                    "团队定时任务为只读",
                    Map.of("scheduleId", schedule.getId())
            );
        }
    }
}
