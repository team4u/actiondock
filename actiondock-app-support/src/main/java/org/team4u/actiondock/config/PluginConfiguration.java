package org.team4u.actiondock.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.actiondock.ai.core.AiAgentRuntimeImpl;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.SystemPluginStateRepository;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.workspace.plugin.ActionDockWorkspaceSystemPlugin;

import java.util.List;

/**
 * 插件相关配置，注册插件运行时服务等 Bean。
 *
 * @author jay.wu
 */
@Configuration(proxyBeanMethods = false)
public class PluginConfiguration {

    @Bean
    public PluginRuntimeService pluginRuntimeService(JsonCodec jsonCodec,
                                                     PluginRegistryRepository pluginRegistryRepository,
                                                     SystemPluginStateRepository systemPluginStateRepository,
                                                     ScriptRepository scriptRepository,
                                                     ConfigValueApplicationService configValueApplicationService,
                                                     AppProperties properties,
                                                     List<ActionDockPlugin> systemPlugins) {
        return new PluginRuntimeService(jsonCodec, pluginRegistryRepository, systemPluginStateRepository, scriptRepository,
                properties.getPlugins(), configValueApplicationService, systemPlugins);
    }

    @Bean
    public ActionDockPlugin actionDockWorkspaceSystemPlugin() {
        return new ActionDockWorkspaceSystemPlugin();
    }

}
