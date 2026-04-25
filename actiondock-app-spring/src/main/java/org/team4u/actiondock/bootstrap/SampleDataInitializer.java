package org.team4u.actiondock.bootstrap;

import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptType;

import java.util.Map;

/**
 * 示例数据初始化器，应用启动时自动创建示例 Groovy 脚本。
 *
 * @author jay.wu
 */
@Component
public class SampleDataInitializer implements CommandLineRunner {
    private final ScriptApplicationService scriptApplicationService;

    public SampleDataInitializer(ScriptApplicationService scriptApplicationService) {
        this.scriptApplicationService = scriptApplicationService;
    }

    /**
     * 应用启动时执行，检测并创建示例 Groovy 脚本。
     * <p>
     * 若示例脚本不存在则自动创建并发布。
     *
     * @param args 启动参数
     */
    @Override
    public void run(String... args) {
        try {
            scriptApplicationService.get("hello-groovy");
        } catch (IllegalArgumentException ignored) {
            ScriptDefinition script = new ScriptDefinition()
                    .setId("hello-groovy")
                    .setName("Hello Groovy")
                    .setType(ScriptType.GROOVY)
                    .setSource("""
                        def name = input.name ?: "World"
                        return [message: "Hello, " + name + "!", upperName: name.toUpperCase()]
                        """)
                    .setInputSchema(Map.of(
                            "type", "object",
                            "properties", Map.of(
                                    "name", Map.of("type", "string", "title", "Name")
                            )
                    ))
                    .setOutputSchema(Map.of(
                            "type", "object",
                            "properties", Map.of(
                                    "message", Map.of("type", "string", "title", "Message"),
                                    "upperName", Map.of("type", "string", "title", "Upper Name")
                            )
                    ));
            scriptApplicationService.save(script);
            scriptApplicationService.publish("hello-groovy");
        }
    }
}
