package org.team4u.scriptflow.application;

import org.team4u.scriptflow.domain.model.PageActionDefinition;
import org.team4u.scriptflow.domain.model.PageBinding;
import org.team4u.scriptflow.domain.model.PageComponent;
import org.team4u.scriptflow.domain.model.PageDefinition;
import org.team4u.scriptflow.domain.model.PageLayout;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.SubmitMode;
import org.team4u.scriptflow.domain.port.PageRepository;
import org.team4u.scriptflow.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class PageDefinitionApplicationService {
    private final PageRepository pageRepository;
    private final ScriptRepository scriptRepository;

    public PageDefinitionApplicationService(PageRepository pageRepository, ScriptRepository scriptRepository) {
        this.pageRepository = pageRepository;
        this.scriptRepository = scriptRepository;
    }

    public PageDefinition save(PageDefinition definition) {
        LocalDateTime now = LocalDateTime.now();
        PageDefinition existing = definition.getId() == null ? null : pageRepository.findById(definition.getId()).orElse(null);
        if (existing == null) {
            definition.setCreatedAt(now);
        } else {
            definition.setCreatedAt(existing.getCreatedAt());
        }
        definition.setUpdatedAt(now);
        return pageRepository.save(definition);
    }

    public PageDefinition get(String id) {
        return pageRepository.findById(id).orElseThrow(() -> new IllegalArgumentException("Page not found: " + id));
    }

    public List<PageDefinition> list() {
        return pageRepository.findAll();
    }

    public void delete(String id) {
        pageRepository.deleteById(id);
    }

    @SuppressWarnings("unchecked")
    public PageDefinition scaffold(String pageId, String scriptId) {
        ScriptDefinition scriptDefinition = scriptRepository.findById(scriptId)
                .orElseThrow(() -> new IllegalArgumentException("Script not found: " + scriptId));

        Map<String, Object> inputSchema = scriptDefinition.getInputSchema();
        Map<String, Object> outputSchema = scriptDefinition.getOutputSchema();

        List<PageComponent> components = new ArrayList<>();
        Map<String, String> inputMapping = new LinkedHashMap<>();
        Map<String, String> outputMapping = new LinkedHashMap<>();

        Map<String, Object> inputProperties = nestedProperties(inputSchema);
        int idx = 1;
        for (Map.Entry<String, Object> entry : inputProperties.entrySet()) {
            String field = entry.getKey();
            Map<String, Object> meta = entry.getValue() instanceof Map<?, ?> m ? castMap(m) : new LinkedHashMap<>();
            components.add(new PageComponent()
                    .setId("input-" + idx++)
                    .setRegion("input")
                    .setType(toPageType(String.valueOf(meta.getOrDefault("type", "string"))))
                    .setName(field)
                    .setLabel(String.valueOf(meta.getOrDefault("title", field)))
                    .setProps(meta));
            inputMapping.put(field, field);
        }

        Map<String, Object> outputProperties = nestedProperties(outputSchema);
        idx = 1;
        for (Map.Entry<String, Object> entry : outputProperties.entrySet()) {
            String field = entry.getKey();
            Map<String, Object> meta = entry.getValue() instanceof Map<?, ?> m ? castMap(m) : new LinkedHashMap<>();
            components.add(new PageComponent()
                    .setId("output-" + idx++)
                    .setRegion("output")
                    .setType("static")
                    .setName(field)
                    .setLabel(String.valueOf(meta.getOrDefault("title", field)))
                    .setProps(meta));
            outputMapping.put(field, field);
        }

        PageDefinition page = new PageDefinition()
                .setId(pageId)
                .setName(scriptDefinition.getName() + " Page")
                .setRenderer("amis")
                .setLayout(new PageLayout())
                .setComponents(components)
                .setActions(List.of(new PageActionDefinition()
                        .setId("submit")
                        .setName("执行")
                        .setType("SUBMIT")
                        .setMethod("POST")
                        .setOptions(Map.of("async", false))))
                .setBinding(new PageBinding()
                        .setScriptId(scriptId)
                        .setInputMapping(inputMapping)
                        .setOutputMapping(outputMapping)
                        .setSubmitMode(SubmitMode.SYNC));

        return save(page);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> nestedProperties(Map<String, Object> schema) {
        if (schema == null) {
            return new LinkedHashMap<>();
        }
        Object properties = schema.get("properties");
        if (properties instanceof Map<?, ?> map) {
            return castMap(map);
        }
        return new LinkedHashMap<>();
    }

    private String toPageType(String type) {
        return switch (type) {
            case "integer", "number" -> "number";
            case "boolean" -> "switch";
            default -> "text";
        };
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> castMap(Map<?, ?> source) {
        Map<String, Object> target = new LinkedHashMap<>();
        source.forEach((k, v) -> target.put(String.valueOf(k), v));
        return target;
    }
}
