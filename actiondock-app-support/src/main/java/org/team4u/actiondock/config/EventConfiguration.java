package org.team4u.actiondock.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.EventIngestionApplicationService;
import org.team4u.actiondock.application.EventRecordApplicationService;
import org.team4u.actiondock.application.EventSourceApplicationService;
import org.team4u.actiondock.application.EventTriggerApplicationService;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.domain.port.EventDispatchRepository;
import org.team4u.actiondock.domain.port.EventRecordRepository;
import org.team4u.actiondock.domain.port.EventSourceRepository;
import org.team4u.actiondock.domain.port.EventTriggerRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ProcessorEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;

/**
 * 事件相关配置，注册事件源、触发器、事件摄取和事件记录等 Bean。
 *
 * @author jay.wu
 */
@Configuration(proxyBeanMethods = false)
public class EventConfiguration {

    @Bean
    public EventSourceApplicationService eventSourceApplicationService(EventSourceRepository eventSourceRepository,
                                                                       ProcessorEngine processorEngine) {
        return new EventSourceApplicationService(eventSourceRepository, processorEngine);
    }

    @Bean
    public EventTriggerApplicationService eventTriggerApplicationService(EventTriggerRepository eventTriggerRepository,
                                                                         EventSourceRepository eventSourceRepository,
                                                                         EventDispatchRepository eventDispatchRepository,
                                                                         ScriptRepository scriptRepository,
                                                                         ProcessorEngine processorEngine,
                                                                         ExecutionApplicationService executionApplicationService) {
        return new EventTriggerApplicationService(
                eventTriggerRepository,
                eventSourceRepository,
                eventDispatchRepository,
                scriptRepository,
                processorEngine,
                executionApplicationService
        );
    }

    @Bean
    public EventIngestionApplicationService eventIngestionApplicationService(EventSourceApplicationService eventSourceApplicationService,
                                                                             EventTriggerApplicationService eventTriggerApplicationService,
                                                                             EventRecordRepository eventRecordRepository,
                                                                             ConfigValueApplicationService configValueApplicationService,
                                                                             JsonCodec jsonCodec,
                                                                             ProcessorEngine processorEngine) {
        return new EventIngestionApplicationService(
                eventSourceApplicationService,
                eventTriggerApplicationService,
                eventRecordRepository,
                configValueApplicationService,
                jsonCodec,
                processorEngine
        );
    }

    @Bean
    public EventRecordApplicationService eventRecordApplicationService(EventRecordRepository eventRecordRepository,
                                                                       EventDispatchRepository eventDispatchRepository) {
        return new EventRecordApplicationService(eventRecordRepository, eventDispatchRepository);
    }
}
