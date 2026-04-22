package org.team4u.scriptflow.application;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ScriptSchemaSupportTest {
    private final ScriptSchemaSupport support = new ScriptSchemaSupport();

    @Test
    void summarizeReturnsSupportedAndUnsupportedFields() {
        ScriptSchemaSupport.SchemaSummary summary = support.summarize(Map.of(
                "type", "object",
                "required", List.of("name"),
                "properties", Map.of(
                        "name", Map.of(
                                "type", "string",
                                "title", "Name",
                                "description", "用户名",
                                "default", "guest"
                        ),
                        "mode", Map.of("enum", List.of("FAST", "SAFE"), "default", "FAST"),
                        "profile", Map.of("type", "object", "title", "Profile")
                )
        ));

        assertThat(summary.fields()).extracting(ScriptSchemaSupport.SchemaField::name)
                .containsExactlyInAnyOrder("name", "mode", "profile");
        assertThat(summary.fields()).anySatisfy(field -> {
            assertThat(field.name()).isEqualTo("name");
            assertThat(field.description()).isEqualTo("用户名");
            assertThat(field.defaultValue()).isEqualTo("guest");
        });
        assertThat(summary.fields()).anySatisfy(field -> {
            assertThat(field.name()).isEqualTo("mode");
            assertThat(field.kind()).isEqualTo("enum");
            assertThat(field.enumValues()).containsExactly("FAST", "SAFE");
            assertThat(field.defaultValue()).isEqualTo("FAST");
        });
        assertThat(summary.fields()).anySatisfy(field -> {
            assertThat(field.name()).isEqualTo("profile");
            assertThat(field.kind()).isEqualTo("object");
        });
    }

    @Test
    void validateInputRejectsMissingRequiredField() {
        assertThatThrownBy(() -> support.validateInput("script-1", Map.of(), Map.of(
                "type", "object",
                "required", List.of("name"),
                "properties", Map.of(
                        "name", Map.of("type", "string", "title", "Name")
                )
        )))
                .isInstanceOf(InvalidExecutionInputException.class)
                .satisfies(error -> {
                    InvalidExecutionInputException exception = (InvalidExecutionInputException) error;
                    assertThat(exception.getFieldErrors()).containsExactly(
                            new SchemaFieldError("name", "required", "Name 为必填", "present", "missing")
                    );
                });
    }

    @Test
    void validateInputRejectsTypeMismatchAndEnumMismatch() {
        assertThatThrownBy(() -> support.validateInput("script-1", Map.of(
                "age", "18",
                "mode", "DEBUG"
        ), Map.of(
                "type", "object",
                "properties", Map.of(
                        "age", Map.of("type", "integer", "title", "Age"),
                        "mode", Map.of("type", "string", "title", "Mode", "enum", List.of("FAST", "SAFE"))
                )
        )))
                .isInstanceOf(InvalidExecutionInputException.class)
                .satisfies(error -> {
                    InvalidExecutionInputException exception = (InvalidExecutionInputException) error;
                    assertThat(exception.getFieldErrors()).containsExactlyInAnyOrder(
                            new SchemaFieldError("age", "type_mismatch", "Age 必须是 integer", "integer", "string"),
                            new SchemaFieldError("mode", "enum_mismatch", "Mode 必须是枚举值之一: FAST, SAFE", "enum(FAST, SAFE)", "DEBUG")
                    );
                });
    }

    @Test
    void validateInputSkipsValidationWhenSchemaMissing() {
        support.validateInput("script-1", Map.of("any", "value"), Map.of());
    }
}
