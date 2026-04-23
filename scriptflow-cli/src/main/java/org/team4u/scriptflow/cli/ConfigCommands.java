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

@Command(name = "config", mixinStandardHelpOptions = true, description = "Commands for CLI connection settings and profile management.", subcommands = {ConfigCommands.CurrentConfig.class, ConfigCommands.ProfileCommands.class})
/**
 * 配置管理命令组，提供连接配置查看和 profile 管理等子命令。
 *
 * @author jay.wu
 */
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

    @Command(name = "current", mixinStandardHelpOptions = true, description = "Show the effective connection config, including value sources, token presence, and config file path.")
    static class CurrentConfig implements Callable<Integer> {
        @ParentCommand
        ConfigCommands parent;

        @Override
        public Integer call() {
            return parent.root().emitLocalSuccess(parent.root().configService().toResolvedNode(parent.root().resolveConnectionConfig()));
        }
    }

    @Command(name = "profile", mixinStandardHelpOptions = true, description = "Manage local profiles stored in ~/.scriptflow/config.json.", subcommands = {ListProfiles.class, GetProfile.class, SetProfile.class, DeleteProfile.class})
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

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List all local profiles and show the current profile.")
    static class ListProfiles implements Callable<Integer> {
        @ParentCommand
        ProfileCommands parent;

        @Override
        public Integer call() {
            CliConfigService.ConfigFile file = parent.root().loadConfigFile();
            return parent.root().emitLocalSuccess(parent.root().configService().toProfilesNode(file));
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Show the config for a single local profile.")
    static class GetProfile implements Callable<Integer> {
        @ParentCommand
        ProfileCommands parent;

        @Parameters(index = "0", paramLabel = "<profileName>", description = "Profile name.")
        String profileName;

        @Override
        public Integer call() {
            CliConfigService.ConfigFile file = parent.root().loadConfigFile();
            CliConfigService.ProfileConfig profile = file.getProfiles().get(profileName);
            if (profile == null) {
                throw CliException.business(parent.root().output(), "Profile does not exist: " + profileName);
            }
            return parent.root().emitLocalSuccess(
                    parent.root().configService().toProfileNode(profileName, profile, profileName.equals(file.getCurrentProfile()))
            );
        }
    }

    @Command(name = "set", mixinStandardHelpOptions = true, description = {
            "Create or update a local profile and make it the current profile.",
            "Options you do not provide keep their existing values. A new profile is created if it does not exist.",
            "--base-url automatically removes a trailing slash."
    })
    static class SetProfile implements Callable<Integer> {
        @ParentCommand
        ProfileCommands parent;

        @Parameters(index = "0", paramLabel = "<profileName>", description = "Profile name to create or update.")
        String profileName;

        @Option(names = "--base-url", description = "Service base URL, for example http://localhost:8080.")
        String baseUrl;

        @Option(names = "--token", description = "Bearer token. Blank values are normalized to null.")
        String token;

        @Option(names = "--connect-timeout-ms", description = "HTTP connect timeout in milliseconds.")
        Integer connectTimeoutMs;

        @Option(names = "--read-timeout-ms", description = "HTTP read timeout in milliseconds.")
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
                    "Config saved"
            );
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete a local profile. If it is the current profile, currentProfile is cleared.")
    static class DeleteProfile implements Callable<Integer> {
        @ParentCommand
        ProfileCommands parent;

        @Parameters(index = "0", paramLabel = "<profileName>", description = "Profile name to delete.")
        String profileName;

        @Override
        public Integer call() {
            CliConfigService.ConfigFile file = parent.root().loadConfigFile();
            CliConfigService.ProfileConfig removed = file.getProfiles().remove(profileName);
            if (removed == null) {
                throw CliException.business(parent.root().output(), "Profile does not exist: " + profileName);
            }
            if (profileName.equals(file.getCurrentProfile())) {
                file.setCurrentProfile(null);
            }
            parent.root().saveConfigFile(file);
            return parent.root().emitLocalSuccess(parent.root().configService().toProfilesNode(file), "Config deleted");
        }
    }
}
