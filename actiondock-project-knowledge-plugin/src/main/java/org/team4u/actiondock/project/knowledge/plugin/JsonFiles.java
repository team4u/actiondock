package org.team4u.actiondock.project.knowledge.plugin;

import org.team4u.actiondock.plugin.api.PluginObjectMappers;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * JSON 文件读写工具。
 *
 * <p>基于 {@link PluginObjectMappers} 提供带自动目录创建和格式化输出的 JSON 序列化/反序列化能力。
 */
final class JsonFiles {
    private JsonFiles() {
    }

    /**
     * 将对象序列化为 JSON 并写入文件，自动创建父目录。
     *
     * @param path  目标文件路径
     * @param value 待序列化的对象
     */
    static void write(Path path, Object value) {
        try {
            Path parent = path.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Files.writeString(path,
                    PluginObjectMappers.DEFAULT.writerWithDefaultPrettyPrinter().writeValueAsString(value),
                    StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new PluginRuntimeException("Cannot write JSON file: " + path, exception);
        }
    }

    /**
     * 从 JSON 文件反序列化为指定类型。
     *
     * @param path 目标文件路径
     * @param type 目标类型
     * @return 反序列化后的对象
     */
    static <T> T read(Path path, Class<T> type) {
        try {
            return PluginObjectMappers.DEFAULT.readValue(Files.readString(path, StandardCharsets.UTF_8), type);
        } catch (IOException exception) {
            throw new PluginRuntimeException("Cannot read JSON file: " + path, exception);
        }
    }
}
