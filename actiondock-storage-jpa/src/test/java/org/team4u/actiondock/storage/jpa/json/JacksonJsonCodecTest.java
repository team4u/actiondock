package org.team4u.actiondock.storage.jpa.json;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.ScriptDefinition;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JacksonJsonCodecTest {
    private final JacksonJsonCodec codec = new JacksonJsonCodec(new ObjectMapper());

    @Test
    void writeAndReadRoundTripObjectsListsAndMaps() {
        String objectJson = codec.write(new ScriptDefinition().setId("script-1").setName("Hello"));
        String listJson = codec.write(List.of(new ScriptDefinition().setId("script-2")));
        String mapJson = codec.write(Map.of("name", "Alice"));

        assertThat(codec.read(objectJson, ScriptDefinition.class).getName()).isEqualTo("Hello");
        assertThat(codec.readUntyped("[1,2,3]")).isEqualTo(List.of(1, 2, 3));
        assertThat(codec.readUntyped("\"hello\"")).isEqualTo("hello");
        assertThat(codec.readList(listJson, ScriptDefinition.class))
                .singleElement()
                .satisfies(definition -> {
                    assertThat(definition.getId()).isEqualTo("script-2");
                });
        assertThat(codec.readMap(mapJson)).containsEntry("name", "Alice");
    }

    @Test
    void blankJsonReturnsNullOrEmptyCollections() {
        assertThat(codec.write(null)).isNull();
        assertThat(codec.read(" ", ScriptDefinition.class)).isNull();
        assertThat(codec.readUntyped(" ")).isNull();
        assertThat(codec.readList("", ScriptDefinition.class)).isEmpty();
        assertThat(codec.readMap(null)).isEmpty();
    }

    @Test
    void invalidJsonThrowsIllegalStateException() {
        assertThatThrownBy(() -> codec.read("{bad json}", ScriptDefinition.class))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Cannot deserialize value");
        assertThatThrownBy(() -> codec.readUntyped("{"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Cannot deserialize value");
        assertThatThrownBy(() -> codec.readList("[", ScriptDefinition.class))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Cannot deserialize list");
        assertThatThrownBy(() -> codec.readMap("{"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Cannot deserialize map");
    }
}
