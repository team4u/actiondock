package org.team4u.scriptflow.web;

import org.springframework.scheduling.support.CronExpression;
import org.team4u.scriptflow.domain.model.ExecutionStatus;
import org.team4u.scriptflow.domain.model.ScriptSchedule;
import org.team4u.scriptflow.domain.port.ExecutionRepository;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

final class ScriptScheduleViewMapper {
    private final ExecutionRepository executionRepository;

    ScriptScheduleViewMapper(ExecutionRepository executionRepository) {
        this.executionRepository = executionRepository;
    }

    ScriptScheduleView toView(ScriptSchedule schedule) {
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

    private LocalDateTime nextRunAt(ScriptSchedule schedule) {
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

    private Map<String, Object> copy(Map<String, Object> value) {
        return value == null ? new LinkedHashMap<>() : new LinkedHashMap<>(value);
    }
}
