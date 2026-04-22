package org.team4u.scriptflow.cli;

import com.fasterxml.jackson.databind.JsonNode;
import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.Spec;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Callable;

@Command(name = "config", mixinStandardHelpOptions = true, description = "CLI 连接配置和 profile 管理命令。", subcommands = {ConfigCommands.CurrentConfig.class, ConfigCommands.ProfileCommands.class})
class ConfigCommands implements Runnable {
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

    @Command(name = "current", mixinStandardHelpOptions = true, description = "显示最终生效的连接配置，包括值来源、token 是否存在和配置文件路径。")
    static class CurrentConfig implements Callable<Integer> {
        @ParentCommand
        ConfigCommands parent;

        @Override
        public Integer call() {
            return parent.root().emitLocalSuccess(parent.root().configService().toResolvedNode(parent.root().resolveConnectionConfig()));
        }
    }

    @Command(name = "profile", mixinStandardHelpOptions = true, description = "管理本地 profile；配置文件位于 ~/.scriptflow/config.json。", subcommands = {ListProfiles.class, GetProfile.class, SetProfile.class, DeleteProfile.class})
    static class ProfileCommands implements Runnable {
        @ParentCommand
        ConfigCommands parent;

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

    @Command(name = "list", mixinStandardHelpOptions = true, description = "列出所有本地 profile 名称和当前 profile。")
    static class ListProfiles implements Callable<Integer> {
        @ParentCommand
        ProfileCommands parent;

        @Override
        public Integer call() {
            CliConfigService.ConfigFile file = parent.root().loadConfigFile();
            return parent.root().emitLocalSuccess(parent.root().configService().toProfilesNode(file));
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "查看单个本地 profile 的配置。")
    static class GetProfile implements Callable<Integer> {
        @ParentCommand
        ProfileCommands parent;

        @Parameters(index = "0", paramLabel = "<profileName>", description = "Profile 名称。")
        String profileName;

        @Override
        public Integer call() {
            CliConfigService.ConfigFile file = parent.root().loadConfigFile();
            CliConfigService.ProfileConfig profile = file.getProfiles().get(profileName);
            if (profile == null) {
                throw CliException.business(parent.root().output(), "profile 不存在: " + profileName);
            }
            return parent.root().emitLocalSuccess(
                    parent.root().configService().toProfileNode(profileName, profile, profileName.equals(file.getCurrentProfile()))
            );
        }
    }

    @Command(name = "set", mixinStandardHelpOptions = true, description = {
            "创建或更新一个本地 profile，并将其设为当前 profile。",
            "未提供的选项会保留该 profile 现有值；如果 profile 不存在则创建。",
            "--base-url 会自动去掉末尾斜杠。"
    })
    static class SetProfile implements Callable<Integer> {
        @ParentCommand
        ProfileCommands parent;

        @Parameters(index = "0", paramLabel = "<profileName>", description = "要创建或更新的 profile 名称。")
        String profileName;

        @Option(names = "--base-url", description = "服务根地址，例如 http://localhost:8080。")
        String baseUrl;

        @Option(names = "--token", description = "Bearer token；传空白值会被规范化为 null。")
        String token;

        @Option(names = "--connect-timeout-ms", description = "HTTP 连接超时时间，单位毫秒。")
        Integer connectTimeoutMs;

        @Option(names = "--read-timeout-ms", description = "HTTP 读超时时间，单位毫秒。")
        Integer readTimeoutMs;

        @Override
        public Integer call() {
            CliConfigService.ConfigFile file = parent.root().loadConfigFile();
            CliConfigService.ProfileConfig profile = file.getProfiles().getOrDefault(profileName, new CliConfigService.ProfileConfig());
            if (baseUrl != null) {
                profile.setBaseUrl(parent.root().configService().normalizeBaseUrl(baseUrl));
            }
            if (token != null) {
                profile.setToken(parent.root().configService().normalizeString(token));
            }
            if (connectTimeoutMs != null) {
                profile.setConnectTimeoutMs(connectTimeoutMs);
            }
            if (readTimeoutMs != null) {
                profile.setReadTimeoutMs(readTimeoutMs);
            }
            file.getProfiles().put(profileName, profile);
            file.setCurrentProfile(profileName);
            parent.root().saveConfigFile(file);
            return parent.root().emitLocalSuccess(
                    parent.root().configService().toProfileNode(profileName, profile, true),
                    "配置已保存"
            );
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "删除本地 profile；如果删除的是当前 profile，则 currentProfile 会被清空。")
    static class DeleteProfile implements Callable<Integer> {
        @ParentCommand
        ProfileCommands parent;

        @Parameters(index = "0", paramLabel = "<profileName>", description = "要删除的 profile 名称。")
        String profileName;

        @Override
        public Integer call() {
            CliConfigService.ConfigFile file = parent.root().loadConfigFile();
            CliConfigService.ProfileConfig removed = file.getProfiles().remove(profileName);
            if (removed == null) {
                throw CliException.business(parent.root().output(), "profile 不存在: " + profileName);
            }
            if (profileName.equals(file.getCurrentProfile())) {
                file.setCurrentProfile(null);
            }
            parent.root().saveConfigFile(file);
            return parent.root().emitLocalSuccess(parent.root().configService().toProfilesNode(file), "配置已删除");
        }
    }
}
