package org.team4u.actiondock.storage.jpa.json;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.team4u.actiondock.domain.port.JsonCodec;

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

    /**
     * 将对象序列化为 JSON 字符串。
     *
     * @param value 待序列化对象，为 null 时返回 null
     * @return JSON 字符串
     * @throws IllegalStateException 序列化失败时抛出
     */
    @Override
    public String write(Object value) {
        try {
            return value == null ? null : objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Cannot serialize value", e);
        }
    }

    /**
     * 将 JSON 字符串反序列化为指定类型的对象。
     *
     * @param json JSON 字符串，为 null 或空白时返回 null
     * @param type 目标类型
     * @return 反序列化后的对象
     * @throws IllegalStateException 反序列化失败时抛出
     */
    @Override
    public <T> T read(String json, Class<T> type) {
        return readJson(json, () -> objectMapper.readValue(json, type));
    }

    /**
     * 将 JSON 字符串反序列化为无类型对象（Map/List/基本类型）。
     *
     * @param json JSON 字符串，为 null 或空白时返回 null
     * @return 反序列化后的对象
     * @throws IllegalStateException 反序列化失败时抛出
     */
    @Override
    public Object readUntyped(String json) {
        return readJson(json, () -> objectMapper.readValue(json, Object.class));
    }

    /**
     * 将 JSON 字符串反序列化为指定元素类型的列表。
     *
     * @param json JSON 字符串，为 null 或空白时返回空列表
     * @param elementType 列表元素类型
     * @return 反序列化后的列表
     * @throws IllegalStateException 反序列化失败时抛出
     */
    @Override
    public <T> List<T> readList(String json, Class<T> elementType) {
        if (isBlank(json)) {
            return Collections.emptyList();
        }
        JavaType type = objectMapper.getTypeFactory().constructCollectionType(List.class, elementType);
        return parseJson(() -> objectMapper.readValue(json, type), "Cannot deserialize list");
    }

    /**
     * 将 JSON 字符串反序列化为 Map。
     *
     * @param json JSON 字符串，为 null 或空白时返回空 Map
     * @return 反序列化后的 Map
     * @throws IllegalStateException 反序列化失败时抛出
     */
    @SuppressWarnings("unchecked")
    @Override
    public Map<String, Object> readMap(String json) {
        if (isBlank(json)) {
            return Collections.emptyMap();
        }
        return parseJson(() -> objectMapper.readValue(json, Map.class), "Cannot deserialize map");
    }

    /**
     * 判断 JSON 字符串是否为 null 或空白。
     */
    private boolean isBlank(String json) {
        return json == null || json.isBlank();
    }

    /**
     * 执行 JSON 反序列化，将 Jackson 异常统一转换为 IllegalStateException。
     *
     * @param parser 延迟执行的反序列化操作
     * @return 反序列化结果
     * @throws IllegalStateException 反序列化失败时抛出
     */
    private <T> T parseJson(JsonParser<T> parser) {
        return parseJson(parser, "Cannot deserialize value");
    }

    private <T> T parseJson(JsonParser<T> parser, String errorMessage) {
        try {
            return parser.parse();
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(errorMessage, e);
        }
    }

    /**
     * 对 null/空白 JSON 做防护后执行反序列化，空白时返回 null。
     *
     * @param json   JSON 字符串
     * @param parser 延迟执行的反序列化操作
     * @return 反序列化结果，空白时返回 null
     * @throws IllegalStateException 反序列化失败时抛出
     */
    private <T> T readJson(String json, JsonParser<T> parser) {
        if (isBlank(json)) {
            return null;
        }
        return parseJson(parser);
    }

    /**
     * JSON 反序列化操作的函数式接口。
     */
    @FunctionalInterface
    private interface JsonParser<T> {
        T parse() throws JsonProcessingException;
    }
}
