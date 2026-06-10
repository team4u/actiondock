package org.team4u.actiondock.plugin.api;

import java.io.IOException;
import java.io.InputStream;

/**
 * 插件清单加载器，从 classpath 资源中读取并解析插件清单文件。
 * <p>
 * 约定清单文件位于 {@code META-INF/actiondock/plugins/<pluginId>.json}。
 *
 * @author jay.wu
 */
public final class PluginManifestLoader {
    private static final String MANIFEST_ROOT = "META-INF/actiondock/plugins/";

    private PluginManifestLoader() {
    }

    /**
     * 从指定 classpath 资源路径加载插件清单。
     * <p>
     * 使用给定类的类加载器定位资源，并将其反序列化为 {@link PluginManifest}。
     *
     * @param anchorType   用于定位 classpath 资源的锚点类，通常为插件主类
     * @param resourcePath 清单文件的 classpath 路径，如 {@code META-INF/actiondock/plugins/my-plugin.json}
     * @return 解析后的插件清单对象
     * @throws IllegalArgumentException 如果 anchorType 为 null、resourcePath 为空，或资源不存在或无法读取
     */
    public static PluginManifest loadResource(Class<?> anchorType, String resourcePath) {
        if (anchorType == null) {
            throw new IllegalArgumentException("anchorType must not be null");
        }
        if (resourcePath == null || resourcePath.isBlank()) {
            throw new IllegalArgumentException("resourcePath must not be blank");
        }

        try (InputStream inputStream = anchorType.getResourceAsStream(resourcePath)) {
            if (inputStream == null) {
                throw new IllegalArgumentException("Plugin manifest resource not found: " + resourcePath);
            }
            return PluginObjectMappers.DEFAULT.readValue(inputStream, PluginManifest.class);
        } catch (IOException e) {
            throw new IllegalArgumentException("Cannot read plugin manifest resource: " + resourcePath, e);
        }
    }

    /**
     * 根据插件 ID 加载插件清单。
     * <p>
     * 自动拼接清单路径 {@code META-INF/actiondock/plugins/<pluginId>.json}，
     * 使用锚点类的类加载器定位并解析清单文件。
     *
     * @param anchorType 用于定位 classpath 资源的锚点类，通常为插件主类
     * @param pluginId   插件唯一标识
     * @return 解析后的插件清单对象
     * @throws IllegalArgumentException 如果 anchorType 为 null、pluginId 为空，或清单资源不存在或无法读取
     */
    public static PluginManifest load(Class<?> anchorType, String pluginId) {
        if (anchorType == null) {
            throw new IllegalArgumentException("anchorType must not be null");
        }
        if (pluginId == null || pluginId.isBlank()) {
            throw new IllegalArgumentException("pluginId must not be blank");
        }

        String resourcePath = MANIFEST_ROOT + pluginId + ".json";
        try (InputStream inputStream = anchorType.getClassLoader().getResourceAsStream(resourcePath)) {
            if (inputStream == null) {
                throw new IllegalArgumentException("Plugin manifest resource not found for pluginId: " + pluginId);
            }
            return PluginObjectMappers.DEFAULT.readValue(inputStream, PluginManifest.class);
        } catch (IOException e) {
            throw new IllegalArgumentException("Cannot read plugin manifest for pluginId: " + pluginId, e);
        }
    }
}
