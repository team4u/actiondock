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
import org.team4u.actiondock.repository.RepositoryCatalogService;

import java.util.Map;

/**
 * 示例数据初始化器，应用启动时自动创建示例 Groovy 脚本。
 *
 * @author jay.wu
 */
@Component
public class SampleDataInitializer implements CommandLineRunner {
    private static final System.Logger LOGGER = System.getLogger(SampleDataInitializer.class.getName());

    private final ScriptApplicationService scriptApplicationService;
    private final ConfigValueApplicationService configValueApplicationService;
    private final ScriptRepository scriptRepository;
    private final ConfigValueRepository configValueRepository;
    private final RepositoryCatalogService repositoryCatalogService;

    public SampleDataInitializer(ScriptApplicationService scriptApplicationService,
                                 ConfigValueApplicationService configValueApplicationService,
                                 ScriptRepository scriptRepository,
                                 ConfigValueRepository configValueRepository,
                                 RepositoryCatalogService repositoryCatalogService) {
        this.scriptApplicationService = scriptApplicationService;
        this.configValueApplicationService = configValueApplicationService;
        this.scriptRepository = scriptRepository;
        this.configValueRepository = configValueRepository;
        this.repositoryCatalogService = repositoryCatalogService;
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

        if (configValueRepository.findByKey("system.project-entry-template").isEmpty()) {
            configValueApplicationService.create(new ConfigValue()
                    .setKey("system.project-entry-template")
                    .setValue("""
                        ## 优先阅读

                        > 请在此处列出团队成员应首先阅读的关键文档。

                        ## 关键目录

                        > 请在此处列出项目的重要目录结构及说明。
                        """)
                    .setDescription("项目仓库 ACTIONDOCK.md 入口文件的默认模板，支持 ${config.xxx} 占位符"));
        }

        try {
            repositoryCatalogService.refreshRepositoryCache();
        } catch (RuntimeException exception) {
            LOGGER.log(System.Logger.Level.WARNING, "启动时刷新仓库缓存失败", exception);
        }
    }
}
