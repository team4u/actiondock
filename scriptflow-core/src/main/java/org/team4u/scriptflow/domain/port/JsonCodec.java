package org.team4u.scriptflow.domain.port;

import java.util.List;
import java.util.Map;

public interface JsonCodec {
    String write(Object value);

    <T> T read(String json, Class<T> type);

    Object readUntyped(String json);

    <T> List<T> readList(String json, Class<T> elementType);

    Map<String, Object> readMap(String json);
}
