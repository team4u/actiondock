package org.team4u.scriptflow.renderer.amis;

import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.domain.model.PageLayout;
import org.team4u.scriptflow.domain.model.ViewAction;
import org.team4u.scriptflow.domain.model.ViewField;
import org.team4u.scriptflow.domain.model.ViewSchema;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class AmisPageRendererTest {
    private final AmisPageRenderer renderer = new AmisPageRenderer();

    @Test
    void renderBuildsFormAndOutputPanel() {
        ViewSchema schema = new ViewSchema()
                .setPageId("page-1")
                .setTitle("Demo")
                .setLayout(new PageLayout().setFormMode("horizontal").setResultTitle("Results"))
                .setInputFields(List.of(
                        new ViewField()
                                .setName("age")
                                .setLabel("Age")
                                .setType("number")
                                .setProps(Map.of("min", 1))
                ))
                .setOutputFields(List.of(new ViewField().setName("message").setLabel("Message")))
                .setActions(List.of(new ViewAction()
                        .setId("submit")
                        .setLabel("Execute")
                        .setMethod("PUT")
                        .setApi("/custom")));

        Map<String, Object> page = renderer.render(schema);

        assertThat(page).containsEntry("type", "page");
        assertThat(page).containsEntry("title", "Demo");
        List<?> body = (List<?>) page.get("body");
        assertThat(body).hasSize(2);

        Map<String, Object> form = castMap(body.getFirst());
        assertThat(form).containsEntry("type", "form");
        assertThat(form).containsEntry("mode", "horizontal");
        assertThat(castMap(form.get("api"))).containsEntry("method", "PUT").containsEntry("url", "/custom");
        assertThat((List<?>) form.get("actions")).singleElement().isEqualTo(Map.of("type", "submit", "label", "Execute"));
        assertThat((List<?>) form.get("body")).singleElement().satisfies(control -> {
            Map<String, Object> input = castMap(control);
            assertThat(input).containsEntry("type", "input-number");
            assertThat(input).containsEntry("name", "age");
            assertThat(input).containsEntry("min", 1);
        });

        Map<String, Object> panel = castMap(body.get(1));
        assertThat(panel).containsEntry("type", "panel");
        assertThat(panel).containsEntry("title", "Results");
        assertThat((List<?>) panel.get("body")).singleElement().satisfies(control -> {
            Map<String, Object> output = castMap(control);
            assertThat(output).containsEntry("type", "static");
            assertThat(output).containsEntry("name", "message");
        });
    }

    @Test
    void renderFallsBackToDefaultSubmitActionWhenViewHasNoActions() {
        ViewSchema schema = new ViewSchema()
                .setPageId("page-1")
                .setTitle("Demo")
                .setLayout(new PageLayout().setSubmitText("Run"))
                .setInputFields(List.of(new ViewField().setName("name").setLabel("Name")));

        Map<String, Object> page = renderer.render(schema);
        Map<String, Object> form = castMap(((List<?>) page.get("body")).getFirst());

        assertThat(castMap(form.get("api")))
                .containsEntry("method", "POST")
                .containsEntry("url", "/api/page-runtime/page-1/actions/submit");
        assertThat((List<?>) form.get("actions"))
                .singleElement()
                .isEqualTo(Map.of("type", "submit", "label", "Run"));
    }

    @Test
    void renderSkipsOutputPanelWhenNoOutputFieldsAndMapsInputTypes() {
        ViewSchema schema = new ViewSchema()
                .setPageId("page-1")
                .setTitle("Demo")
                .setInputFields(List.of(
                        new ViewField().setName("flag").setLabel("Flag").setType("switch"),
                        new ViewField().setName("description").setLabel("Description").setType("textarea")
                ));

        Map<String, Object> page = renderer.render(schema);
        List<?> body = (List<?>) page.get("body");

        assertThat(body).hasSize(1);
        Map<String, Object> form = castMap(body.getFirst());
        List<?> controls = (List<?>) form.get("body");
        assertThat(controls).hasSize(2);
        assertThat(castMap(controls.get(0))).containsEntry("type", "switch");
        assertThat(castMap(controls.get(1))).containsEntry("type", "textarea");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Object value) {
        return (Map<String, Object>) value;
    }
}
