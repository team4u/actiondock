package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.ProcessorContext;
import org.team4u.actiondock.domain.model.ProcessorDefinition;
import org.team4u.actiondock.domain.model.ProcessorResult;
import org.team4u.actiondock.domain.port.ProcessorEngine;

public class ProcessorApplicationService {
    private final ProcessorEngine processorEngine;

    public ProcessorApplicationService(ProcessorEngine processorEngine) {
        this.processorEngine = processorEngine;
    }

    public ProcessorResult test(ProcessorDefinition processor, ProcessorContext context) {
        if (processor == null) {
            throw new IllegalArgumentException("processor 不能为空");
        }
        return processorEngine.process(processor, context == null ? new ProcessorContext() : context);
    }
}
