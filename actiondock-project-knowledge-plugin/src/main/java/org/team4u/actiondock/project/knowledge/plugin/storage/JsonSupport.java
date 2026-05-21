package org.team4u.actiondock.project.knowledge.plugin.storage;

import org.team4u.actiondock.plugin.api.PluginObjectMappers;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * JSON 文件写入工具类。
 *
 * <p>提供将对象序列化为格式化 JSON 并写入文件的便捷方法，自动创建父目录。
 *
 * @author ActionDock
 */
public final class JsonSupport {
    private JsonSupport() {
    }

    /**
     * 将对象序列化为格式化 JSON 并写入文件，自动创建父目录。
     *
     * @param path  目标文件路径
     * @param value 待序列化的对象
     * @throws PluginRuntimeException 文件写入失败
     */
    public static void writeJson(Path path, Object value) {
        try {
            Path parent = path.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Files.writeString(path, PluginObjectMappers.DEFAULT.writerWithDefaultPrettyPrinter().writeValueAsString(value), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new PluginRuntimeException("Cannot write JSON file: " + path, exception);
        }
    }
}
