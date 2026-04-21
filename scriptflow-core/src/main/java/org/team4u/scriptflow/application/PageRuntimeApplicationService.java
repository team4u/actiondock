package org.team4u.scriptflow.application;

import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.PageActionDefinition;
import org.team4u.scriptflow.domain.model.PageBinding;
import org.team4u.scriptflow.domain.model.PageDefinition;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.SubmitMode;
import org.team4u.scriptflow.domain.model.ViewSchema;
import org.team4u.scriptflow.domain.port.PageRepository;
import org.team4u.scriptflow.domain.port.PageSchemaBuilder;
import org.team4u.scriptflow.domain.port.PageSchemaRenderer;
import org.team4u.scriptflow.domain.port.ScriptRepository;

import java.util.LinkedHashMap;
import java.util.Map;

public class PageRuntimeApplicationService {
    private final PageRepository pageRepository;
    private final ScriptRepository scriptRepository;
    private final ExecutionApplicationService executionApplicationService;
    private final PageSchemaBuilder pageSchemaBuilder;
    private final PageSchemaRenderer pageSchemaRenderer;

    public PageRuntimeApplicationService(PageRepository pageRepository,
                                         ScriptRepository scriptRepository,
                                         ExecutionApplicationService executionApplicationService,
                                         PageSchemaBuilder pageSchemaBuilder,
                                         PageSchemaRenderer pageSchemaRenderer) {
        this.pageRepository = pageRepository;
        this.scriptRepository = scriptRepository;
        this.executionApplicationService = executionApplicationService;
        this.pageSchemaBuilder = pageSchemaBuilder;
        this.pageSchemaRenderer = pageSchemaRenderer;
    }

    public Map<String, Object> schema(String pageId) {
        PageDefinition pageDefinition = pageRepository.findById(pageId)
                .orElseThrow(() -> new IllegalArgumentException("Page not found: " + pageId));
        ScriptDefinition scriptDefinition = scriptRepository.findById(pageDefinition.getBinding().getScriptId())
                .orElseThrow(() -> new IllegalArgumentException("Script not found: " + pageDefinition.getBinding().getScriptId()));
        ViewSchema viewSchema = pageSchemaBuilder.build(pageDefinition, scriptDefinition);
        return pageSchemaRenderer.render(viewSchema);
    }

    public Map<String, Object> submit(String pageId, Map<String, Object> payload) {
        return runAction(pageId, "submit", payload);
    }

    public Map<String, Object> runAction(String pageId, String actionId, Map<String, Object> payload) {
        PageDefinition pageDefinition = pageRepository.findById(pageId)
                .orElseThrow(() -> new IllegalArgumentException("Page not found: " + pageId));
        PageActionDefinition action = pageDefinition.getActions().stream()
                .filter(it -> actionId.equals(it.getId()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Action not found: " + actionId));

        if (!"SUBMIT".equalsIgnoreCase(action.getType())) {
            throw new IllegalArgumentException("Unsupported action type: " + action.getType());
        }

        PageBinding binding = pageDefinition.getBinding();
        Map<String, Object> input = new LinkedHashMap<>();
        binding.getInputMapping().forEach((pageField, scriptField) ->
                input.put(scriptField, payload == null ? null : payload.get(pageField)));

        SubmitMode mode = binding.getSubmitMode();
        Object asyncOption = action.getOptions().get("async");
        if (asyncOption instanceof Boolean async && async) {
            mode = SubmitMode.ASYNC;
        }

        ExecutionRecord record = executionApplicationService.execute(binding.getScriptId(), input, mode);

        Map<String, Object> data = new LinkedHashMap<>();
        if (record.getSubmitMode() == SubmitMode.ASYNC) {
            data.put("executionId", record.getId());
            data.put("status", record.getStatus());
            return data;
        }

        if (binding.getOutputMapping().isEmpty()) {
            data.putAll(record.getDisplayOutput());
            return data;
        }

        binding.getOutputMapping().forEach((scriptField, pageField) ->
                data.put(pageField, record.getDisplayOutput().get(scriptField)));
        data.put("executionId", record.getId());
        data.put("status", record.getStatus());
        return data;
    }
}
