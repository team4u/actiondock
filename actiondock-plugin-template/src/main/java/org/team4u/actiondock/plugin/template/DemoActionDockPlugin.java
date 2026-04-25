package org.team4u.actiondock.plugin.template;

import org.pf4j.Extension;
import org.team4u.actiondock.plugin.api.PluginConfigBinder;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 示例插件实现，提供 echo 动作用于演示插件开发流程。
 * <p>
 * 将输入消息加上配置前缀后原样返回。
 *
 * @author jay.wu
 */
@Extension
public class DemoActionDockPlugin implements ActionDockPlugin {
    @Override
    public String id() {
        return "actiondock-demo-plugin";
    }

    /**
     * 校验插件配置，通过将配置绑定到 {@link DemoPluginConfig} 来验证结构是否正确。
     *
     * @param config 插件配置字典
     */
    @Override
    public void validateConfig(Map<String, Object> config) {
        PluginConfigBinder.bind(config, DemoPluginConfig.class);
    }

    /**
     * 调用插件的 echo 动作，将输入消息加上配置前缀后返回。
     * <p>
     * 目前仅支持 "echo" 动作，将 {@code args.message} 与配置前缀拼接后返回。
     *
     * @param action  动作名称，目前仅支持 "echo"
     * @param context 脚本执行上下文
     * @param args    调用参数，包含 "message" 字段
     * @return 包含拼接后消息和上下文信息的 Map
     * @throws IllegalArgumentException 如果动作名称不被支持
     */
    @Override
    public Object invoke(String action, ScriptPluginContext context, Map<String, Object> args) {
        if ("echo".equals(action)) {
            DemoPluginConfig config = context.getPluginConfig(DemoPluginConfig.class);
            String message = String.valueOf(args.getOrDefault("message", ""));
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("message", config.getPrefix() + ":" + message);
            if (context.getScriptId() != null) {
                result.put("scriptId", context.getScriptId());
            }
            if (context.getExecutionId() != null) {
                result.put("executionId", context.getExecutionId());
            }
            return result;
        }
        throw new IllegalArgumentException("Unsupported action: " + action);
    }
}
