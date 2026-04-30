package org.team4u.actiondock.schedule;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.scheduling.support.CronExpression;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.ScheduleApplicationService;
import org.team4u.actiondock.application.SharedStateApplicationService;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.domain.port.ScheduleExpressionValidator;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.repository.RepositoryCatalogService;

/**
 * 调度模块配置，注册任务调度器和调度分发器。
 *
 * @author jay.wu
 */
@Configuration(proxyBeanMethods = false)
public class ScheduleConfiguration {
    /**
     * 创建脚本调度线程池。
     *
     * @param properties 应用配置属性，读取调度线程池大小
     * @return 配置好的任务调度器
     */
    @Bean
    public TaskScheduler scriptScheduleTaskScheduler(AppProperties properties) {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(properties.getSchedules().getPoolSize());
        scheduler.setThreadNamePrefix("actiondock-schedule-");
        scheduler.initialize();
        return scheduler;
    }

    /**
     * 创建 Cron 表达式校验器，基于 Spring CronExpression 解析验证。
     *
     * @return Cron 表达式校验器
     */
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

    /**
     * 创建脚本调度分发器，负责注册和执行 Cron 定时任务。
     *
     * @param taskScheduler 任务调度器
     * @param scheduleApplicationService 调度应用服务
     * @param executionApplicationService 执行应用服务
     * @param executionRepository 执行记录仓储
     * @param scriptRepository 脚本定义仓储
     * @return 脚本调度分发器
     */
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

    /**
     * 创建共享状态过期自动清理调度器。
     *
     * @param taskScheduler 任务调度器
     * @param sharedStateService 共享状态应用服务
     * @param properties 应用配置属性
     * @return 共享状态清理调度器
     */
    @Bean
    public SharedStateCleanupScheduler sharedStateCleanupScheduler(TaskScheduler taskScheduler,
                                                                    SharedStateApplicationService sharedStateService,
                                                                    AppProperties properties) {
        return new SharedStateCleanupScheduler(taskScheduler, sharedStateService, properties);
    }

    /**
     * 创建仓库自动同步调度器。
     *
     * @param taskScheduler 任务调度器
     * @param repositoryCatalogService 仓库目录服务
     * @param properties 应用配置属性
     * @return 仓库自动同步调度器
     */
    @Bean
    public RepositoryAutoSyncScheduler repositoryAutoSyncScheduler(TaskScheduler taskScheduler,
                                                                   RepositoryCatalogService repositoryCatalogService,
                                                                   AppProperties properties) {
        return new RepositoryAutoSyncScheduler(taskScheduler, repositoryCatalogService, properties);
    }
}
