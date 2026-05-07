package org.team4u.actiondock.web.script;

import org.springframework.stereotype.Component;
import org.springframework.scheduling.support.CronExpression;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.port.ExecutionRepository;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 脚本调度视图映射器，将调度实体转换为包含下次执行时间和最近执行状态的视图。
 *
 * @author jay.wu
 */
@Component
public class ScriptScheduleViewMapper {
    private final ExecutionRepository executionRepository;

    public ScriptScheduleViewMapper(ExecutionRepository executionRepository) {
        this.executionRepository = executionRepository;
    }

    /**
     * 将调度实体转换为视图对象。
     * <p>
     * 计算下次执行时间，并查询最近一次执行的执行状态。
     *
     * @param schedule 调度实体
     * @return 调度视图
     */
    public ScriptScheduleView toView(ScriptSchedule schedule) {
        return new ScriptScheduleView(
                schedule.getId(),
                schedule.getScriptId(),
                schedule.getName(),
                schedule.getCronExpression(),
                copy(schedule.getInput()),
                schedule.isEnabled(),
                nextRunAt(schedule),
                schedule.getLastTriggeredAt(),
                schedule.getLastExecutionId(),
                lastExecutionStatus(schedule.getLastExecutionId()),
                schedule.getCreatedAt(),
                schedule.getUpdatedAt()
        );
    }

    private static LocalDateTime nextRunAt(ScriptSchedule schedule) {
        if (!schedule.isEnabled()) {
            return null;
        }
        return CronExpression.parse(schedule.getCronExpression()).next(LocalDateTime.now());
    }

    private ExecutionStatus lastExecutionStatus(String executionId) {
        if (executionId == null || executionId.isBlank()) {
            return null;
        }
        return executionRepository.findById(executionId)
                .map(record -> record.getStatus())
                .orElse(null);
    }

    private static Map<String, Object> copy(Map<String, Object> value) {
        return value == null ? new LinkedHashMap<>() : new LinkedHashMap<>(value);
    }
}
