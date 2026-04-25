package org.team4u.actiondock.domain.port;

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

    /**
     * 将对象序列化为 JSON 字符串。
     *
     * @param value 要序列化的对象
     * @return JSON 格式的字符串
     */
    String write(Object value);

    /**
     * 将 JSON 字符串反序列化为指定类型的对象。
     *
     * @param json JSON 格式的字符串
     * @param type 目标类型的 Class 对象
     * @param <T>  目标类型
     * @return 反序列化后的对象
     */
    <T> T read(String json, Class<T> type);

    /**
     * 将 JSON 字符串反序列化为未指定类型的对象。
     * <p>
     * 适用于不关心具体类型的场景，返回值通常为 List 或 Map 等通用容器。
     *
     * @param json JSON 格式的字符串
     * @return 反序列化后的对象，类型取决于 JSON 结构
     */
    Object readUntyped(String json);

    /**
     * 将 JSON 数组字符串反序列化为指定元素类型的列表。
     *
     * @param json        JSON 数组格式的字符串
     * @param elementType 列表元素的 Class 对象
     * @param <T>         列表元素类型
     * @return 反序列化后的列表
     */
    <T> List<T> readList(String json, Class<T> elementType);

    /**
     * 将 JSON 对象字符串反序列化为 Map。
     * <p>
     * 键的类型为 String，值的类型取决于 JSON 中的实际数据类型（String、Number、Boolean、List、Map 等）。
     *
     * @param json JSON 对象格式的字符串
     * @return 反序列化后的 Map
     */
    Map<String, Object> readMap(String json);
}
