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

@Command(name = "config", subcommands = {ConfigCommands.CurrentConfig.class, ConfigCommands.ProfileCommands.class})
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

    @Command(name = "current")
    static class CurrentConfig implements Callable<Integer> {
        @ParentCommand
        ConfigCommands parent;

        @Override
        public Integer call() {
            return parent.root().emitLocalSuccess(parent.root().configService().toResolvedNode(parent.root().resolveConnectionConfig()));
        }
    }

    @Command(name = "profile", subcommands = {ListProfiles.class, GetProfile.class, SetProfile.class, DeleteProfile.class})
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

    @Command(name = "list")
    static class ListProfiles implements Callable<Integer> {
        @ParentCommand
        ProfileCommands parent;

        @Override
        public Integer call() {
            CliConfigService.ConfigFile file = parent.root().loadConfigFile();
            return parent.root().emitLocalSuccess(parent.root().configService().toProfilesNode(file));
        }
    }

    @Command(name = "get")
    static class GetProfile implements Callable<Integer> {
        @ParentCommand
        ProfileCommands parent;

        @Parameters(index = "0", description = "Profile name")
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

    @Command(name = "set")
    static class SetProfile implements Callable<Integer> {
        @ParentCommand
        ProfileCommands parent;

        @Parameters(index = "0", description = "Profile name")
        String profileName;

        @Option(names = "--base-url")
        String baseUrl;

        @Option(names = "--token")
        String token;

        @Option(names = "--connect-timeout-ms")
        Integer connectTimeoutMs;

        @Option(names = "--read-timeout-ms")
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

    @Command(name = "delete")
    static class DeleteProfile implements Callable<Integer> {
        @ParentCommand
        ProfileCommands parent;

        @Parameters(index = "0", description = "Profile name")
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
