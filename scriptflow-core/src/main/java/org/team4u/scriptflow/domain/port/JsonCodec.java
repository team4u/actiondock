package org.team4u.scriptflow.domain.port;

import java.util.List;
import java.util.Map;

/**
 * JSON 编解码端口，抽象 JSON 序列化与反序列化能力。
 * <p>
 * 屏蔽底层 JSON 库差异，为领域层提供统一的 JSON 操作接口。
 *
 * @author jay.wu
 */
public interface JsonCodec {
    String write(Object value);

    <T> T read(String json, Class<T> type);

    Object readUntyped(String json);

    <T> List<T> readList(String json, Class<T> elementType);

    Map<String, Object> readMap(String json);
}
