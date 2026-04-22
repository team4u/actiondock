package org.team4u.scriptflow.schedule;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.scheduling.support.CronExpression;
import org.team4u.scriptflow.application.ExecutionApplicationService;
import org.team4u.scriptflow.application.ScheduleApplicationService;
import org.team4u.scriptflow.config.AppProperties;
import org.team4u.scriptflow.domain.port.ExecutionRepository;
import org.team4u.scriptflow.domain.port.ScheduleExpressionValidator;
import org.team4u.scriptflow.domain.port.ScriptRepository;

@Configuration(proxyBeanMethods = false)
public class ScheduleConfiguration {
    @Bean
    public TaskScheduler scriptScheduleTaskScheduler(AppProperties properties) {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(properties.getSchedules().getPoolSize());
        scheduler.setThreadNamePrefix("scriptflow-schedule-");
        scheduler.initialize();
        return scheduler;
    }

    @Bean
    public ScheduleExpressionValidator scheduleExpressionValidator() {
        return expression -> {
            try {
                CronExpression.parse(expression);
            } catch (IllegalArgumentException exception) {
                throw new IllegalArgumentException("Cron 表达式不合法: " + expression, exception);
            }
        };
    }

    @Bean
    public ScriptScheduleDispatcher scriptScheduleDispatcher(TaskScheduler taskScheduler,
                                                             ScheduleApplicationService scheduleApplicationService,
                                                             ExecutionApplicationService executionApplicationService,
                                                             ExecutionRepository executionRepository,
                                                             ScriptRepository scriptRepository) {
        return new ScriptScheduleDispatcher(
                taskScheduler,
                scheduleApplicationService,
                executionApplicationService,
                executionRepository,
                scriptRepository
        );
    }
}
