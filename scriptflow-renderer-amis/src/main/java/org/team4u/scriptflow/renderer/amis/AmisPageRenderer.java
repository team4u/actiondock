package org.team4u.scriptflow.renderer.amis;

import org.team4u.scriptflow.domain.model.ViewAction;
import org.team4u.scriptflow.domain.model.ViewField;
import org.team4u.scriptflow.domain.model.ViewSchema;
import org.team4u.scriptflow.domain.port.PageSchemaRenderer;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class AmisPageRenderer implements PageSchemaRenderer {
    @Override
    public Map<String, Object> render(ViewSchema schema) {
        Map<String, Object> page = new LinkedHashMap<>();
        page.put("type", "page");
        page.put("title", schema.getTitle());

        List<Object> body = new ArrayList<>();
        body.add(buildForm(schema));
        if (!schema.getOutputFields().isEmpty()) {
            body.add(buildOutputPanel(schema));
        }

        page.put("body", body);
        return page;
    }

    private Map<String, Object> buildForm(ViewSchema schema) {
        Map<String, Object> form = new LinkedHashMap<>();
        form.put("type", "form");
        form.put("mode", schema.getLayout().getFormMode());

        ViewAction submitAction = schema.getActions().stream()
                .findFirst()
                .orElse(new ViewAction()
                        .setId("submit")
                        .setLabel(schema.getLayout().getSubmitText())
                        .setMethod("POST")
                        .setApi("/api/page-runtime/" + schema.getPageId() + "/actions/submit"));

        Map<String, Object> api = new LinkedHashMap<>();
        api.put("method", submitAction.getMethod());
        api.put("url", submitAction.getApi());
        form.put("api", api);

        List<Object> controls = new ArrayList<>();
        for (ViewField field : schema.getInputFields()) {
            Map<String, Object> control = new LinkedHashMap<>();
            control.put("type", toAmisInputType(field.getType()));
            control.put("name", field.getName());
            control.put("label", field.getLabel());
            control.putAll(field.getProps());
            controls.add(control);
        }

        List<Object> actions = new ArrayList<>();
        Map<String, Object> submit = new LinkedHashMap<>();
        submit.put("type", "submit");
        submit.put("label", submitAction.getLabel() == null ? schema.getLayout().getSubmitText() : submitAction.getLabel());
        actions.add(submit);

        form.put("body", controls);
        form.put("actions", actions);
        return form;
    }

    private Map<String, Object> buildOutputPanel(ViewSchema schema) {
        Map<String, Object> panel = new LinkedHashMap<>();
        panel.put("type", "panel");
        panel.put("title", schema.getLayout().getResultTitle());

        List<Object> body = new ArrayList<>();
        for (ViewField field : schema.getOutputFields()) {
            Map<String, Object> control = new LinkedHashMap<>();
            control.put("type", "static");
            control.put("name", field.getName());
            control.put("label", field.getLabel());
            body.add(control);
        }
        panel.put("body", body);
        return panel;
    }

    private String toAmisInputType(String type) {
        return switch (type == null ? "text" : type) {
            case "number" -> "input-number";
            case "switch" -> "switch";
            case "textarea" -> "textarea";
            default -> "input-text";
        };
    }
}
