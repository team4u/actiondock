package org.team4u.scriptflow.pagebuilder;

import org.team4u.scriptflow.domain.model.PageActionDefinition;
import org.team4u.scriptflow.domain.model.PageComponent;
import org.team4u.scriptflow.domain.model.PageDefinition;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ViewAction;
import org.team4u.scriptflow.domain.model.ViewField;
import org.team4u.scriptflow.domain.model.ViewSchema;
import org.team4u.scriptflow.domain.port.PageSchemaBuilder;

import java.util.ArrayList;
import java.util.List;

public class DefaultPageSchemaBuilder implements PageSchemaBuilder {
    @Override
    public ViewSchema build(PageDefinition pageDefinition, ScriptDefinition scriptDefinition) {
        List<ViewField> inputs = new ArrayList<>();
        List<ViewField> outputs = new ArrayList<>();
        for (PageComponent component : pageDefinition.getComponents()) {
            ViewField field = new ViewField()
                    .setName(component.getName())
                    .setLabel(component.getLabel())
                    .setType(component.getType())
                    .setProps(component.getProps());
            if ("output".equalsIgnoreCase(component.getRegion())) {
                outputs.add(field);
            } else {
                inputs.add(field);
            }
        }

        List<ViewAction> actions = new ArrayList<>();
        for (PageActionDefinition action : pageDefinition.getActions()) {
            boolean async = Boolean.TRUE.equals(action.getOptions().get("async"));
            actions.add(new ViewAction()
                    .setId(action.getId())
                    .setLabel(action.getName())
                    .setMethod(action.getMethod())
                    .setApi("/api/page-runtime/" + pageDefinition.getId() + "/actions/" + action.getId())
                    .setAsync(async));
        }

        return new ViewSchema()
                .setPageId(pageDefinition.getId())
                .setTitle(pageDefinition.getName())
                .setRenderer(pageDefinition.getRenderer())
                .setLayout(pageDefinition.getLayout())
                .setInputFields(inputs)
                .setOutputFields(outputs)
                .setActions(actions);
    }
}
