package org.team4u.actiondock.plugin;

import org.team4u.actiondock.shared.NormalizeUtils;

import org.team4u.actiondock.domain.model.PluginRegistration;
import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * 插件文件管理器，负责插件 JAR 文件的路径解析、安全校验和文件操作。
 *
 * @author jay.wu
 */
class PluginFileManager {

    private final Path pluginsRoot;

    PluginFileManager(Path pluginsRoot) {
        this.pluginsRoot = pluginsRoot;
    }

    Path resolvePluginPath(PluginRegistration registration) {
        return pluginsRoot.resolve(registration.getFileName()).normalize();
    }

    Path uniquePluginPath(String fileName) {
        Path target = pluginsRoot.resolve(fileName);
        if (!Files.exists(target)) {
            return target;
        }
        int dot = fileName.lastIndexOf('.');
        String base = dot >= 0 ? fileName.substring(0, dot) : fileName;
        String extension = dot >= 0 ? fileName.substring(dot) : "";
        int index = 1;
        while (Files.exists(target)) {
            target = pluginsRoot.resolve(base + "-" + index + extension);
            index++;
        }
        return target;
    }

    void deletePluginFile(PluginRegistration registration) {
        try {
            Files.deleteIfExists(resolvePluginPath(registration));
        } catch (IOException e) {
            throw new PluginRuntimeException("删除插件文件失败: " + registration.getPluginId(), e);
        }
    }

    static String sanitizeFilename(String originalFilename) {
        String value = NormalizeUtils.isBlank(originalFilename) ? "plugin.jar" : originalFilename;
        String fileName = Path.of(value).getFileName().toString();
        if (!fileName.endsWith(".jar")) {
            throw new IllegalArgumentException("仅支持上传 .jar 插件包");
        }
        return fileName;
    }
}
