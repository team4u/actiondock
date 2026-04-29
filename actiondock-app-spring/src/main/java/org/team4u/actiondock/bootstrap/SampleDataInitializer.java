package org.team4u.actiondock.bootstrap;

import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.util.Map;

/**
 * 示例数据初始化器，应用启动时自动创建示例 Groovy 脚本。
 *
 * @author jay.wu
 */
@Component
public class SampleDataInitializer implements CommandLineRunner {
    private final ScriptApplicationService scriptApplicationService;
    private final ConfigValueApplicationService configValueApplicationService;
    private final ScriptRepository scriptRepository;
    private final ConfigValueRepository configValueRepository;

    public SampleDataInitializer(ScriptApplicationService scriptApplicationService,
                                 ConfigValueApplicationService configValueApplicationService,
                                 ScriptRepository scriptRepository,
                                 ConfigValueRepository configValueRepository) {
        this.scriptApplicationService = scriptApplicationService;
        this.configValueApplicationService = configValueApplicationService;
        this.scriptRepository = scriptRepository;
        this.configValueRepository = configValueRepository;
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
        if (scriptRepository.findById("hello-groovy").isEmpty()) {
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

        if (configValueRepository.findByKey("system.default-owner").isEmpty()) {
            configValueApplicationService.create(new ConfigValue()
                    .setKey("system.default-owner")
                    .setValue("")
                    .setDescription("发布到仓库时默认的维护人/作者名称"));
        }
    }
}
