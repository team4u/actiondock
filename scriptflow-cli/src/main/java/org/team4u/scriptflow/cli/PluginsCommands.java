package org.team4u.scriptflow.cli;

import com.fasterxml.jackson.databind.JsonNode;
import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.Spec;

import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.Callable;

@Command(name = "plugins", mixinStandardHelpOptions = true, description = "插件的安装、生命周期、调用和配置命令。", subcommands = {
        PluginsCommands.ListPlugins.class, PluginsCommands.GetPlugin.class, PluginsCommands.InstallPlugin.class, PluginsCommands.UpgradePlugin.class,
        PluginsCommands.StartPlugin.class, PluginsCommands.StopPlugin.class, PluginsCommands.DeletePlugin.class, PluginsCommands.InvokePlugin.class, PluginsCommands.PluginConfigCommands.class
})
/**
 * 插件管理命令组，提供插件的安装、启停、调用和配置等子命令。
 *
 * @author jay.wu
 */
class PluginsCommands implements Runnable {
    @ParentCommand
    ScriptFlowCommand root;

    @Spec
    CommandSpec spec;

    ScriptFlowCommand root() {
        return root;
    }

    @Override
    public void run() {
        spec.commandLine().usage(root.services.stdout());
    }

    @Command(name = "list", mixinStandardHelpOptions = true, description = "列出已安装插件。")
    static class ListPlugins implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/plugins", Map.of()));
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "获取单个插件详情。")
    static class GetPlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "插件 ID。")
        String pluginId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/plugins/" + parent.root().encodePath(pluginId), Map.of()));
        }
    }

    @Command(name = "install", mixinStandardHelpOptions = true, description = "上传并安装插件 JAR 包。")
    static class InstallPlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Option(names = "--jar", required = true, description = "待安装插件 JAR 文件路径。")
        String jarPath;

        @Override
        public Integer call() {
            ScriptFlowCommand root = parent.root();
            byte[] content = JsonInputSupport.readBinaryFile(root.output(), jarPath, "插件 JAR");
            return root.emit(root.apiClient().postMultipart("/api/plugins/install", Map.of(), "file", Path.of(jarPath), content));
        }
    }

    @Command(name = "upgrade", mixinStandardHelpOptions = true, description = "使用新的插件 JAR 升级指定插件。")
    static class UpgradePlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "要升级的插件 ID。")
        String pluginId;

        @Option(names = "--jar", required = true, description = "用于升级的插件 JAR 文件路径。")
        String jarPath;

        @Override
        public Integer call() {
            ScriptFlowCommand root = parent.root();
            byte[] content = JsonInputSupport.readBinaryFile(root.output(), jarPath, "插件 JAR");
            return root.emit(root.apiClient().postMultipart(
                    "/api/plugins/" + root.encodePath(pluginId) + "/upgrade",
                    Map.of(),
                    "file",
                    Path.of(jarPath),
                    content
            ));
        }
    }

    @Command(name = "start", mixinStandardHelpOptions = true, description = "启动指定插件。")
    static class StartPlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "插件 ID。")
        String pluginId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson("/api/plugins/" + parent.root().encodePath(pluginId) + "/start", Map.of(), "{}"));
        }
    }

    @Command(name = "stop", mixinStandardHelpOptions = true, description = "停止指定插件。")
    static class StopPlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "插件 ID。")
        String pluginId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson("/api/plugins/" + parent.root().encodePath(pluginId) + "/stop", Map.of(), "{}"));
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "删除指定插件。")
    static class DeletePlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "插件 ID。")
        String pluginId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/plugins/" + parent.root().encodePath(pluginId), Map.of()));
        }
    }

    @Command(name = "invoke", mixinStandardHelpOptions = true, description = {
            "调用插件的某个 action。",
            "action 名称来自路径参数；--args 传 action 自身参数，--script-input 传给插件的脚本输入上下文，两者会分别进入服务端 PluginInvokeRequest 的 args 和 scriptInput。",
            "--args/--args-file 和 --script-input/--script-input-file 都是二选一；顶层必须是 JSON 对象；各自不传时默认 {}。",
            "--response-view=RESULT 只看结果，DEBUG 会额外返回 debug 区块，其中包含原始 args 和 scriptInput。"
    })
    static class InvokePlugin implements Callable<Integer> {
        @ParentCommand
        PluginsCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "插件 ID。")
        String pluginId;

        @Parameters(index = "1", paramLabel = "<action>", description = "要调用的 action 名称。")
        String action;

        @Option(names = "--args", description = "内联 action 参数 JSON；顶层必须是 JSON 对象，和 --args-file 二选一。")
        String args;

        @Option(names = "--args-file", description = "action 参数 JSON 文件路径；传 - 表示从 stdin 读取，和 --args 二选一。")
        String argsFile;

        @Option(names = "--script-input", description = "内联脚本输入上下文 JSON；顶层必须是 JSON 对象，和 --script-input-file 二选一。")
        String scriptInput;

        @Option(names = "--script-input-file", description = "脚本输入上下文 JSON 文件路径；传 - 表示从 stdin 读取，和 --script-input 二选一。")
        String scriptInputFile;

        @Option(names = "--response-view", defaultValue = "RESULT", description = "返回视图：${COMPLETION-CANDIDATES}；RESULT 返回业务结果，DEBUG 返回调试细节；默认 ${DEFAULT-VALUE}。")
        ScriptFlowCommand.ResponseViewOption responseView;

        @Override
        public Integer call() {
            ScriptFlowCommand root = parent.root();
            String resolvedArgs = JsonInputSupport.readOptionalJsonObject(root.output(), root.objectMapper(), args, argsFile, "插件参数");
            String resolvedScriptInput = JsonInputSupport.readOptionalJsonObject(root.output(), root.objectMapper(), scriptInput, scriptInputFile, "脚本输入");
            String body = root.jsonObject(Map.of(
                    "args", JsonInputSupport.readTree(root.objectMapper(), root.output(), resolvedArgs),
                    "scriptInput", JsonInputSupport.readTree(root.objectMapper(), root.output(), resolvedScriptInput),
                    "responseView", responseView.name()
            ));
            return root.emit(root.apiClient().postJson(
                    "/api/plugins/" + root.encodePath(pluginId) + "/actions/" + root.encodePath(action) + "/invoke",
                    Map.of(),
                    body
            ));
        }
    }

    @Command(name = "config", mixinStandardHelpOptions = true, description = "插件配置查询和更新命令。", subcommands = {GetPluginConfig.class, SetPluginConfig.class})
    static class PluginConfigCommands implements Runnable {
        @ParentCommand
        PluginsCommands parent;

        @Spec
        CommandSpec spec;

        ScriptFlowCommand root() {
            return parent.root();
        }

        @Override
        public void run() {
            spec.commandLine().usage(root().services.stdout());
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "获取插件配置。")
    static class GetPluginConfig implements Callable<Integer> {
        @ParentCommand
        PluginConfigCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "插件 ID。")
        String pluginId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/plugins/" + parent.root().encodePath(pluginId) + "/config", Map.of()));
        }
    }

    @Command(name = "set", mixinStandardHelpOptions = true, description = {
            "更新插件配置。",
            "--file 必须提供插件配置请求体 JSON；顶层必须是 JSON 对象。",
            "请求体需要符合 /api/plugins/{pluginId}/config 的结构，也就是顶层包含 config 字段，例如 {\"config\":{...}}。",
            "--file=- 时从 stdin 读取。"
    })
    static class SetPluginConfig implements Callable<Integer> {
        @ParentCommand
        PluginConfigCommands parent;

        @Parameters(index = "0", paramLabel = "<pluginId>", description = "插件 ID。")
        String pluginId;

        @Option(names = "--file", required = true, description = "插件配置请求体 JSON 文件路径；传 - 表示从 stdin 读取。")
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "插件配置请求体");
            return parent.root().emit(parent.root().apiClient().putJson(
                    "/api/plugins/" + parent.root().encodePath(pluginId) + "/config",
                    Map.of(),
                    body
            ));
        }
    }
}
