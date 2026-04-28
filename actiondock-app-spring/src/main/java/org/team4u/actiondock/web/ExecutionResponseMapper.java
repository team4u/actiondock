package org.team4u.actiondock.web;

import org.team4u.actiondock.application.ExecutionOutputProjector;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionLogEntry;
import org.team4u.actiondock.domain.model.ScriptDefinition;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 执行结果映射器，将执行记录转换为 API 响应对象。
 *
 * @author jay.wu
 */
final class ExecutionResponseMapper {
    private final ExecutionOutputProjector executionOutputProjector = new ExecutionOutputProjector();

    /**
     * 将执行记录转换为 API 响应对象。
     * <p>
     * 根据视图模式决定是否包含调试信息（原始输入和输出），
     * 并基于脚本输出 Schema 投影过滤输出字段。
     *
     * @param record 执行记录
     * @param scriptDefinition 脚本定义，用于输出投影
     * @param responseView 响应视图模式
     * @return 执行结果响应
     */
    ExecutionResponse toResponse(ExecutionRecord record,
                                 ScriptDefinition scriptDefinition,
                                 ExecutionResponseView responseView) {
        Map<String, Object> rawOutput = copy(record.getOutput());
        ExecutionResponse.DebugPayload debugPayload = responseView == ExecutionResponseView.DEBUG
                ? new ExecutionResponse.DebugPayload(copy(record.getInput()), rawOutput)
                : null;
        return new ExecutionResponse(
                record.getId(),
                record.getScriptId(),
                record.getStatus(),
                record.getSubmitMode(),
                record.getTriggerSource(),
                record.getScheduleId(),
                record.getAgentRunId(),
                record.getAgentStepId(),
                executionOutputProjector.project(rawOutput, scriptDefinition.getOutputSchema()),
                copyLogs(record.getLogs()),
                record.getErrorMessage(),
                record.getErrorDetail(),
                record.getCreatedAt(),
                record.getStartedAt(),
                record.getFinishedAt(),
                debugPayload
        );
    }

    private Map<String, Object> copy(Map<String, Object> value) {
        return value == null ? new LinkedHashMap<>() : new LinkedHashMap<>(value);
    }

    private List<ExecutionLogEntry> copyLogs(List<ExecutionLogEntry> value) {
        return value == null ? List.of() : List.copyOf(value);
    }
}
