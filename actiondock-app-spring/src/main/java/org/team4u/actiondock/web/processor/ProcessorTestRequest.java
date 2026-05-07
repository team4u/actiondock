package org.team4u.actiondock.web.processor;

import org.team4u.actiondock.domain.model.ProcessorContext;
import org.team4u.actiondock.domain.model.ProcessorDefinition;

import java.util.Map;

public class ProcessorTestRequest {
    private ProcessorDefinition processor;
    private ProcessorContext context = new ProcessorContext();
    private Map<String, Object> expectedOutputSchema = Map.of();

    public ProcessorDefinition getProcessor() {
        return processor;
    }

    public void setProcessor(ProcessorDefinition processor) {
        this.processor = processor;
    }

    public ProcessorContext getContext() {
        return context;
    }

    public void setContext(ProcessorContext context) {
        this.context = context == null ? new ProcessorContext() : context;
    }

    public Map<String, Object> getExpectedOutputSchema() {
        return expectedOutputSchema;
    }

    public void setExpectedOutputSchema(Map<String, Object> expectedOutputSchema) {
        this.expectedOutputSchema = expectedOutputSchema == null ? Map.of() : expectedOutputSchema;
    }
}
