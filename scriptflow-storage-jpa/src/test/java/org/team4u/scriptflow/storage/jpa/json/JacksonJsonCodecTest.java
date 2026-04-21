package org.team4u.scriptflow.storage.jpa.json;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.domain.model.PageActionDefinition;
import org.team4u.scriptflow.domain.model.PageLayout;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JacksonJsonCodecTest {
    private final JacksonJsonCodec codec = new JacksonJsonCodec(new ObjectMapper());

    @Test
    void writeAndReadRoundTripObjectsListsAndMaps() {
        String objectJson = codec.write(new PageLayout().setFormMode("vertical"));
        String listJson = codec.write(List.of(new PageActionDefinition().setId("submit").setType("SUBMIT")));
        String mapJson = codec.write(Map.of("name", "Alice"));

        assertThat(codec.read(objectJson, PageLayout.class).getFormMode()).isEqualTo("vertical");
        assertThat(codec.readList(listJson, PageActionDefinition.class))
                .singleElement()
                .satisfies(action -> {
                    assertThat(action.getId()).isEqualTo("submit");
                    assertThat(action.getType()).isEqualTo("SUBMIT");
                });
        assertThat(codec.readMap(mapJson)).containsEntry("name", "Alice");
    }

    @Test
    void blankJsonReturnsNullOrEmptyCollections() {
        assertThat(codec.write(null)).isNull();
        assertThat(codec.read(" ", PageLayout.class)).isNull();
        assertThat(codec.readList("", PageActionDefinition.class)).isEmpty();
        assertThat(codec.readMap(null)).isEmpty();
    }

    @Test
    void invalidJsonThrowsIllegalStateException() {
        assertThatThrownBy(() -> codec.read("{bad json}", PageLayout.class))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Cannot deserialize value");
        assertThatThrownBy(() -> codec.readList("[", PageActionDefinition.class))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Cannot deserialize list");
        assertThatThrownBy(() -> codec.readMap("{"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Cannot deserialize map");
    }
}
