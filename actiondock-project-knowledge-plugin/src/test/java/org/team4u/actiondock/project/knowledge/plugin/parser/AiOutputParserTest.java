package org.team4u.actiondock.project.knowledge.plugin.parser;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class AiOutputParserTest {
    private final AiOutputParser parser = new AiOutputParser();

    @Test
    void parsesDirectJson() {
        ParsedAiOutput output = parser.parse("{\"title\":\"ok\"}");

        assertThat(output.status()).isEqualTo("done");
        assertThat(output.parsedOutput()).containsEntry("title", "ok");
    }

    @Test
    void parsesMarkdownJsonBlock() {
        ParsedAiOutput output = parser.parse("result:\n```json\n{\"title\":\"ok\"}\n```");

        assertThat(output.status()).isEqualTo("done");
        assertThat(output.parsedOutput()).containsEntry("title", "ok");
    }

    @Test
    void parsesJsonFragmentInsideText() {
        ParsedAiOutput output = parser.parse("prefix {\"title\":\"ok\"} suffix");

        assertThat(output.status()).isEqualTo("done");
        assertThat(output.parsedOutput()).containsEntry("title", "ok");
    }

    @Test
    void keepsReadableTextAsNeedsReview() {
        ParsedAiOutput output = parser.parse("This is readable but not JSON.");

        assertThat(output.status()).isEqualTo("needs_review");
        assertThat(output.parseError()).isEqualTo("not-json");
        assertThat(output.parsedOutput()).containsEntry("format", "plain-text");
    }
}
