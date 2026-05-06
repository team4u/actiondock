package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.ProcessorContext;
import org.team4u.actiondock.domain.model.ProcessorDefinition;
import org.team4u.actiondock.domain.model.ProcessorResult;

@FunctionalInterface
public interface ProcessorEngine {
    ProcessorResult process(ProcessorDefinition processor, ProcessorContext context);
}
