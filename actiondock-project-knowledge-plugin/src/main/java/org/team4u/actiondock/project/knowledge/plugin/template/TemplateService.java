package org.team4u.actiondock.project.knowledge.plugin.template;

import org.team4u.actiondock.plugin.api.PluginRuntimeException;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class TemplateService {
    private static final String ROOT = "project-knowledge/templates/";
    private final Map<String, String> cache = new ConcurrentHashMap<>();

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
