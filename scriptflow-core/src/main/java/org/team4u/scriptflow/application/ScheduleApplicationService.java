package org.team4u.scriptflow.application;

import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptSchedule;
import org.team4u.scriptflow.domain.port.ScheduleExpressionValidator;
import org.team4u.scriptflow.domain.port.ScriptRepository;
import org.team4u.scriptflow.domain.port.ScriptScheduleRepository;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class ScheduleApplicationService {
    private final ScriptScheduleRepository scriptScheduleRepository;
    private final ScriptRepository scriptRepository;
    private final ScheduleExpressionValidator scheduleExpressionValidator;

    public ScheduleApplicationService(ScriptScheduleRepository scriptScheduleRepository,
                                      ScriptRepository scriptRepository,
                                      ScheduleExpressionValidator scheduleExpressionValidator) {
        this.scriptScheduleRepository = scriptScheduleRepository;
        this.scriptRepository = scriptRepository;
        this.scheduleExpressionValidator = scheduleExpressionValidator;
    }

    public List<ScriptSchedule> list(String scriptId) {
        ensureScriptExists(scriptId);
        return scriptScheduleRepository.findByScriptId(scriptId);
    }

    public List<ScriptSchedule> listAll() {
        return scriptScheduleRepository.findAll();
    }

    public List<ScriptSchedule> listEnabled() {
        return scriptScheduleRepository.findEnabled();
    }

    public ScriptSchedule getById(String scheduleId) {
        return getByIdInternal(scheduleId);
    }

    public ScriptSchedule get(String scriptId, String scheduleId) {
        ScriptSchedule schedule = getById(scheduleId);
        ensureScheduleBelongsToScript(schedule, scriptId);
        return schedule;
    }

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
        }

        String name = normalize(schedule.getName(), "定时任务名称不能为空");
        String cronExpression = normalize(schedule.getCronExpression(), "Cron 表达式不能为空");
        scheduleExpressionValidator.validate(cronExpression);

        target.setScriptId(script.getId())
                .setName(name)
                .setCronExpression(cronExpression)
                .setInput(copy(schedule.getInput()))
                .setEnabled(schedule.isEnabled())
                .setUpdatedAt(now);
        return scriptScheduleRepository.save(target);
    }

    public ScriptSchedule enable(String scriptId, String scheduleId) {
        ensurePublishedScript(scriptId);
        ScriptSchedule schedule = get(scriptId, scheduleId);
        scheduleExpressionValidator.validate(schedule.getCronExpression());
        schedule.setEnabled(true).setUpdatedAt(LocalDateTime.now());
        return scriptScheduleRepository.save(schedule);
    }

    public ScriptSchedule disable(String scriptId, String scheduleId) {
        ScriptSchedule schedule = get(scriptId, scheduleId);
        schedule.setEnabled(false).setUpdatedAt(LocalDateTime.now());
        return scriptScheduleRepository.save(schedule);
    }

    public void delete(String scriptId, String scheduleId) {
        ScriptSchedule schedule = get(scriptId, scheduleId);
        scriptScheduleRepository.deleteById(schedule.getId());
    }

    public ScriptSchedule markTriggered(String scheduleId, String executionId, LocalDateTime triggeredAt) {
        ScriptSchedule schedule = getById(scheduleId);
        schedule.setLastExecutionId(executionId)
                .setLastTriggeredAt(triggeredAt)
                .setUpdatedAt(triggeredAt);
        return scriptScheduleRepository.save(schedule);
    }

    public void clearByScriptId(String scriptId) {
        scriptScheduleRepository.deleteByScriptId(scriptId);
    }

    private ScriptDefinition ensurePublishedScript(String scriptId) {
        ScriptDefinition script = ensureScriptExists(scriptId);
        if (script.getPublishedSnapshot() == null) {
            throw new IllegalArgumentException("Script not published: " + scriptId);
        }
        return script;
    }

    private ScriptDefinition ensureScriptExists(String scriptId) {
        return scriptRepository.findById(scriptId)
                .orElseThrow(() -> new IllegalArgumentException("Script not found: " + scriptId));
    }

    private ScriptSchedule getByIdInternal(String scheduleId) {
        return scriptScheduleRepository.findById(scheduleId)
                .orElseThrow(() -> new IllegalArgumentException("Schedule not found: " + scheduleId));
    }

    private void ensureScheduleBelongsToScript(ScriptSchedule schedule, String scriptId) {
        if (!schedule.getScriptId().equals(scriptId)) {
            throw new IllegalArgumentException("Schedule does not belong to script: " + schedule.getId());
        }
    }

    private Map<String, Object> copy(Map<String, Object> input) {
        return input == null ? new LinkedHashMap<>() : new LinkedHashMap<>(input);
    }

    private String normalize(String value, String message) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(message);
        }
        return value.trim();
    }
}
