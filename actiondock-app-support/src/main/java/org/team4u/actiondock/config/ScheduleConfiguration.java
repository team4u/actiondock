package org.team4u.actiondock.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ScheduleApplicationService;
import org.team4u.actiondock.domain.port.ScheduleExpressionValidator;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;

/**
 * 调度相关配置，注册调度表达式验证器和调度应用服务等 Bean。
 *
 * @author jay.wu
 */
@Configuration(proxyBeanMethods = false)
public class ScheduleConfiguration {

    @Bean
    @ConditionalOnMissingBean(ScheduleExpressionValidator.class)
    public ScheduleExpressionValidator defaultScheduleExpressionValidator() {
        return expression -> {
        };
    }

    @Bean
    public ScheduleApplicationService scheduleApplicationService(ScriptScheduleRepository scriptScheduleRepository,
                                                                 ScriptRepository scriptRepository,
                                                                 ScheduleExpressionValidator scheduleExpressionValidator,
                                                                 ConfigValueApplicationService configValueApplicationService) {
        return new ScheduleApplicationService(scriptScheduleRepository, scriptRepository, scheduleExpressionValidator, configValueApplicationService);
    }
}
