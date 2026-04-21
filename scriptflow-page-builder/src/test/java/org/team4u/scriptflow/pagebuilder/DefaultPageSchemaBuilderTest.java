package org.team4u.scriptflow.pagebuilder;

import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.domain.model.PageActionDefinition;
import org.team4u.scriptflow.domain.model.PageComponent;
import org.team4u.scriptflow.domain.model.PageDefinition;
import org.team4u.scriptflow.domain.model.PageLayout;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ViewSchema;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class DefaultPageSchemaBuilderTest {
    private final DefaultPageSchemaBuilder builder = new DefaultPageSchemaBuilder();

    @Test
    void buildSplitsInputAndOutputFieldsAndMapsActions() {
        PageLayout layout = new PageLayout().setFormMode("vertical").setSubmitText("Go");
        PageDefinition page = new PageDefinition()
                .setId("page-1")
                .setName("Demo")
                .setRenderer("amis")
                .setLayout(layout)
                .setComponents(List.of(
                        new PageComponent()
                                .setRegion("input")
                                .setType("number")
                                .setName("age")
                                .setLabel("Age")
                                .setProps(Map.of("min", 1)),
                        new PageComponent()
                                .setRegion("output")
                                .setType("static")
                                .setName("message")
                                .setLabel("Message")
                                .setProps(Map.of("tpl", "${message}"))
                ))
                .setActions(List.of(new PageActionDefinition()
                        .setId("submit")
                        .setName("Execute")
                        .setMethod("PUT")
                        .setOptions(Map.of("async", true))));

        ViewSchema schema = builder.build(page, new ScriptDefinition());

        assertThat(schema.getPageId()).isEqualTo("page-1");
        assertThat(schema.getTitle()).isEqualTo("Demo");
        assertThat(schema.getRenderer()).isEqualTo("amis");
        assertThat(schema.getLayout()).isSameAs(layout);
        assertThat(schema.getInputFields()).singleElement().satisfies(field -> {
            assertThat(field.getName()).isEqualTo("age");
            assertThat(field.getType()).isEqualTo("number");
            assertThat(field.getProps()).containsEntry("min", 1);
        });
        assertThat(schema.getOutputFields()).singleElement().satisfies(field -> {
            assertThat(field.getName()).isEqualTo("message");
            assertThat(field.getLabel()).isEqualTo("Message");
            assertThat(field.getProps()).containsEntry("tpl", "${message}");
        });
        assertThat(schema.getActions()).singleElement().satisfies(action -> {
            assertThat(action.getId()).isEqualTo("submit");
            assertThat(action.getLabel()).isEqualTo("Execute");
            assertThat(action.getMethod()).isEqualTo("PUT");
            assertThat(action.getApi()).isEqualTo("/api/page-runtime/page-1/actions/submit");
            assertThat(action.isAsync()).isTrue();
        });
    }
}
