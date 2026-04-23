package org.team4u.scriptflow.storage.jpa.json;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.team4u.scriptflow.domain.port.JsonCodec;

import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * 基于 Jackson 的 JSON 编解码器实现。
 * <p>
 * 为领域层 JsonCodec 端口提供具体的序列化与反序列化能力。
 *
 * @author jay.wu
 */
public class JacksonJsonCodec implements JsonCodec {
    private final ObjectMapper objectMapper;

    public JacksonJsonCodec(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper.copy()
                .findAndRegisterModules()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    @Override
    public String write(Object value) {
        try {
            return value == null ? null : objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Cannot serialize value", e);
        }
    }

    @Override
    public <T> T read(String json, Class<T> type) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, type);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Cannot deserialize value", e);
        }
    }

    @Override
    public Object readUntyped(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, Object.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Cannot deserialize value", e);
        }
    }

    @Override
    public <T> List<T> readList(String json, Class<T> elementType) {
        if (json == null || json.isBlank()) {
            return Collections.emptyList();
        }
        try {
            JavaType type = objectMapper.getTypeFactory().constructCollectionType(List.class, elementType);
            return objectMapper.readValue(json, type);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Cannot deserialize list", e);
        }
    }

    @SuppressWarnings("unchecked")
    @Override
    public Map<String, Object> readMap(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyMap();
        }
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Cannot deserialize map", e);
        }
    }
}
