package org.team4u.actiondock.project.knowledge.plugin.template;

import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 模板加载服务。
 *
 * <p>从 classpath 加载知识库任务模板，使用 {@link ConcurrentHashMap} 缓存已加载的模板内容，
 * 避免重复的 I/O 操作。模板文件位于 {@code project-knowledge/templates/} 资源目录下。
 *
 * @author ActionDock
 */
public class TemplateService {
    private static final String ROOT = "project-knowledge/templates/";
    private final Map<String, String> cache = new ConcurrentHashMap<>();

    /**
     * 加载指定名称的模板内容。
     *
     * <p>首次加载后缓存结果，后续调用直接返回缓存内容。
     *
     * @param name 模板文件名（如 {@code template-common.md}）
     * @return 模板内容字符串
     * @throws PluginRuntimeException 模板文件不存在或读取失败
     */
    public String load(String name) {
        return cache.computeIfAbsent(name, this::loadResource);
    }

    private String loadResource(String name) {
        String resource = ROOT + name;
        try (InputStream inputStream = TemplateService.class.getClassLoader().getResourceAsStream(resource)) {
            if (inputStream == null) {
                throw new PluginRuntimeException("Project knowledge template not found: " + name);
            }
            return new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new PluginRuntimeException("Cannot read project knowledge template: " + name, exception);
        }
    }
}
