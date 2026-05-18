package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.ErrorDetail;
import org.team4u.actiondock.domain.model.ExecutionLogEntry;
import org.team4u.actiondock.domain.model.ExecutionLogLevel;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.port.ExecutionRepository;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 执行日志收集器，线程安全地收集执行日志并管理执行记录的最终状态。
 *
 * @author jay.wu
 */
class ExecutionLogCollector {

    private static final System.Logger log = System.getLogger(ExecutionLogCollector.class.getName());

    private final ExecutionRecord record;
    private final ExecutionRepository executionRepository;
    private final Object monitor = new Object();

    ExecutionLogCollector(ExecutionRecord record, ExecutionRepository executionRepository) {
        this.record = record;
        this.executionRepository = executionRepository;
    }

    void append(ExecutionLogLevel level, String message) {
        synchronized (monitor) {
            record.addLog(new ExecutionLogEntry()
                    .setLevel(level)
                    .setMessage(message)
                    .setCreatedAt(LocalDateTime.now()));
            try {
                executionRepository.save(record);
            } catch (Exception ex) {
                log.log(System.Logger.Level.WARNING, "保存执行日志失败: " + record.getId(), ex);
            }
        }
    }

    ExecutionRecord completeSuccess(Map<String, Object> output) {
        synchronized (monitor) {
            record.setOutput(output);
            record.setErrorMessage(null);
            record.setErrorDetail(null);
            record.setStatus(ExecutionStatus.SUCCESS);
            record.setFinishedAt(LocalDateTime.now());
            return safeSave(record);
        }
    }

    ExecutionRecord completeFailure(Exception exception) {
        if (exception instanceof StructuredExecutionException structuredException) {
            return completeFailure(
                    structuredException.getMessage(),
                    structuredException.getDetail()
            );
        }
        return completeFailure(
                ErrorDetailSupport.summarize(exception),
                ErrorDetailSupport.describe(exception)
        );
    }

    ExecutionRecord completeFailure(String message, ErrorDetail detail) {
        synchronized (monitor) {
            record.setStatus(ExecutionStatus.FAILED);
            record.setErrorMessage(message);
            record.setErrorDetail(detail);
            record.setFinishedAt(LocalDateTime.now());
            return safeSave(record);
        }
    }

    private ExecutionRecord safeSave(ExecutionRecord record) {
        try {
            return executionRepository.save(record);
        } catch (Exception ex) {
            log.log(System.Logger.Level.WARNING, "保存执行记录失败: " + record.getId(), ex);
            return record;
        }
    }
}
