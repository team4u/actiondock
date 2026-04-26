package org.team4u.actiondock.cli;

import picocli.CommandLine.Command;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Option;
import picocli.CommandLine.Parameters;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.Spec;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Callable;

@Command(name = "repositories", mixinStandardHelpOptions = true, description = "Commands for repository definitions, tools, and repository plugins.", subcommands = {
        RepositoriesCommands.ListRepositories.class,
        RepositoriesCommands.CreateRepository.class,
        RepositoriesCommands.UpdateRepository.class,
        RepositoriesCommands.DeleteRepository.class,
        RepositoriesCommands.SyncRepository.class,
        RepositoriesCommands.RepositoryToolCommands.class,
        RepositoriesCommands.RepositoryPluginCommands.class
})
/**
 * 仓库命令组，提供仓库定义、仓库工具和仓库插件的 REST CLI 入口。
 *
 * @author jay.wu
 */
class RepositoriesCommands implements Runnable {
    @ParentCommand
    ActionDockCommand root;

    @Spec
    CommandSpec spec;

    ActionDockCommand root() {
        return root;
    }

    @Override
    public void run() {
        spec.commandLine().usage(root.services.stdout());
    }

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List repository definitions.")
    static class ListRepositories implements Callable<Integer> {
        @ParentCommand
        RepositoriesCommands parent;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/repositories", Map.of()));
        }
    }

    @Command(name = "create", mixinStandardHelpOptions = true, description = {
            "Create a repository definition.",
            "--file is required and must provide a JSON object matching the /api/repositories request body.",
            "Use --file=- to read from stdin."
    })
    static class CreateRepository implements Callable<Integer> {
        @ParentCommand
        RepositoriesCommands parent;

        @Option(names = "--file", required = true, description = "Path to the repository definition JSON file. Use - to read from stdin.")
        String filePath;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Repository definition");
            return parent.root().emit(parent.root().apiClient().postJson("/api/repositories", Map.of(), body));
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = {
            "Update a repository definition.",
            "--file is required and must provide a JSON object matching the /api/repositories/{id} request body.",
            "Use --file=- to read from stdin."
    })
    static class UpdateRepository implements Callable<Integer> {
        @ParentCommand
        RepositoriesCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Option(names = "--file", required = true, description = "Path to the repository definition JSON file. Use - to read from stdin.")
        String filePath;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            String body = JsonInputSupport.readRequiredJsonObject(root.output(), root.objectMapper(), filePath, "Repository definition");
            return root.emit(root.apiClient().putJson("/api/repositories/" + root.encodePath(repositoryId), Map.of(), body));
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete a repository definition.")
    static class DeleteRepository implements Callable<Integer> {
        @ParentCommand
        RepositoriesCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/repositories/" + parent.root().encodePath(repositoryId), Map.of()));
        }
    }

    @Command(name = "sync", mixinStandardHelpOptions = true, description = "Sync a repository catalog.")
    static class SyncRepository implements Callable<Integer> {
        @ParentCommand
        RepositoriesCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().postJson("/api/repositories/" + parent.root().encodePath(repositoryId) + "/sync", Map.of(), "{}"));
        }
    }

    @Command(name = "tools", mixinStandardHelpOptions = true, description = "Commands for repository-managed tools.", subcommands = {
            ListRepositoryTools.class,
            GetRepositoryTool.class,
            InstallRepositoryTool.class,
            UpdateRepositoryTool.class,
            DevelopRepositoryTool.class,
            PublishRepositoryTool.class,
            UninstallRepositoryTool.class
    })
    static class RepositoryToolCommands implements Runnable {
        @ParentCommand
        RepositoriesCommands parent;

        @Spec
        CommandSpec spec;

        ActionDockCommand root() {
            return parent.root();
        }

        @Override
        public void run() {
            spec.commandLine().usage(root().services.stdout());
        }
    }

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List tools declared by repositories.")
    static class ListRepositoryTools implements Callable<Integer> {
        @ParentCommand
        RepositoryToolCommands parent;

        @Option(names = "--repository-id", description = "Optional repository ID. If omitted, all enabled repositories are scanned.")
        String repositoryId;

        @Override
        public Integer call() {
            String path = repositoryId == null || repositoryId.isBlank()
                    ? "/api/repositories/tools"
                    : "/api/repositories/" + parent.root().encodePath(repositoryId) + "/tools";
            return parent.root().emit(parent.root().apiClient().get(path, Map.of()));
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Get details for a repository tool.")
    static class GetRepositoryTool implements Callable<Integer> {
        @ParentCommand
        RepositoryToolCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Parameters(index = "1", paramLabel = "<toolId>", description = "Repository tool ID.")
        String toolId;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.emit(root.apiClient().get(
                    "/api/repositories/" + root.encodePath(repositoryId) + "/tools/" + root.encodePath(toolId),
                    Map.of()
            ));
        }
    }

    @Command(name = "install", mixinStandardHelpOptions = true, description = "Install a tool from a repository.")
    static class InstallRepositoryTool implements Callable<Integer> {
        @ParentCommand
        RepositoryToolCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Parameters(index = "1", paramLabel = "<toolId>", description = "Repository tool ID.")
        String toolId;

        @Option(names = "--install-schedules", description = "Install schedule templates declared by the repository tool.")
        boolean installSchedules;

        @Option(names = "--install-plugin-dependencies", description = "Install plugin dependencies declared by the repository tool.")
        boolean installPluginDependencies;

        @Option(names = "--force-plugin-upgrade", description = "Force plugin dependency upgrades when version ranges conflict.")
        boolean forcePluginUpgrade;

        @Override
        public Integer call() {
            return submitToolInstall(parent.root(), repositoryId, toolId, "install", installSchedules, installPluginDependencies, forcePluginUpgrade);
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = "Update an installed repository tool.")
    static class UpdateRepositoryTool implements Callable<Integer> {
        @ParentCommand
        RepositoryToolCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Parameters(index = "1", paramLabel = "<toolId>", description = "Repository tool ID.")
        String toolId;

        @Option(names = "--install-schedules", description = "Update schedule templates declared by the repository tool.")
        boolean installSchedules;

        @Option(names = "--install-plugin-dependencies", description = "Install or update plugin dependencies declared by the repository tool.")
        boolean installPluginDependencies;

        @Option(names = "--force-plugin-upgrade", description = "Force plugin dependency upgrades when version ranges conflict.")
        boolean forcePluginUpgrade;

        @Override
        public Integer call() {
            return submitToolInstall(parent.root(), repositoryId, toolId, "update", installSchedules, installPluginDependencies, forcePluginUpgrade);
        }
    }

    @Command(name = "develop", mixinStandardHelpOptions = true, description = "Sync a repository tool into a local development script.")
    static class DevelopRepositoryTool implements Callable<Integer> {
        @ParentCommand
        RepositoryToolCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Parameters(index = "1", paramLabel = "<toolId>", description = "Repository tool ID.")
        String toolId;

        @Option(names = "--script-id", description = "Optional target development script ID.")
        String scriptId;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            Map<String, Object> body = new LinkedHashMap<>();
            if (scriptId != null && !scriptId.isBlank()) {
                body.put("scriptId", scriptId);
            }
            return root.emit(root.apiClient().postJson(
                    "/api/repositories/" + root.encodePath(repositoryId) + "/tools/" + root.encodePath(toolId) + "/develop",
                    Map.of(),
                    root.jsonObject(body)
            ));
        }
    }

    @Command(name = "publish", mixinStandardHelpOptions = true, description = {
            "Publish a local script into a repository.",
            "--file is required and must provide a JSON object matching the /api/repositories/{repositoryId}/publish request body.",
            "Use --file=- to read from stdin."
    })
    static class PublishRepositoryTool implements Callable<Integer> {
        @ParentCommand
        RepositoryToolCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Option(names = "--file", required = true, description = "Path to the publish request JSON file. Use - to read from stdin.")
        String filePath;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            String body = JsonInputSupport.readRequiredJsonObject(root.output(), root.objectMapper(), filePath, "Repository tool publish request body");
            return root.emit(root.apiClient().postJson(
                    "/api/repositories/" + root.encodePath(repositoryId) + "/publish",
                    Map.of(),
                    body
            ));
        }
    }

    @Command(name = "uninstall", mixinStandardHelpOptions = true, description = "Uninstall an installed repository tool by its installed script ID.")
    static class UninstallRepositoryTool implements Callable<Integer> {
        @ParentCommand
        RepositoryToolCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Installed script ID.")
        String scriptId;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().delete("/api/installed-tools/" + parent.root().encodePath(scriptId), Map.of()));
        }
    }

    @Command(name = "plugins", mixinStandardHelpOptions = true, description = "Commands for repository-managed plugins.", subcommands = {
            ListRepositoryPlugins.class,
            GetRepositoryPlugin.class,
            InstallRepositoryPlugin.class,
            UpdateRepositoryPlugin.class,
            PublishRepositoryPlugin.class
    })
    static class RepositoryPluginCommands implements Runnable {
        @ParentCommand
        RepositoriesCommands parent;

        @Spec
        CommandSpec spec;

        ActionDockCommand root() {
            return parent.root();
        }

        @Override
        public void run() {
            spec.commandLine().usage(root().services.stdout());
        }
    }

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List plugins declared by repositories.")
    static class ListRepositoryPlugins implements Callable<Integer> {
        @ParentCommand
        RepositoryPluginCommands parent;

        @Option(names = "--repository-id", description = "Optional repository ID. If omitted, all enabled repositories are scanned.")
        String repositoryId;

        @Override
        public Integer call() {
            String path = repositoryId == null || repositoryId.isBlank()
                    ? "/api/repositories/plugins"
                    : "/api/repositories/" + parent.root().encodePath(repositoryId) + "/plugins";
            return parent.root().emit(parent.root().apiClient().get(path, Map.of()));
        }
    }

    @Command(name = "get", mixinStandardHelpOptions = true, description = "Get details for a repository plugin.")
    static class GetRepositoryPlugin implements Callable<Integer> {
        @ParentCommand
        RepositoryPluginCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Parameters(index = "1", paramLabel = "<pluginId>", description = "Repository plugin ID.")
        String pluginId;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.emit(root.apiClient().get(
                    "/api/repositories/" + root.encodePath(repositoryId) + "/plugins/" + root.encodePath(pluginId),
                    Map.of()
            ));
        }
    }

    @Command(name = "install", mixinStandardHelpOptions = true, description = "Install a plugin from a repository.")
    static class InstallRepositoryPlugin implements Callable<Integer> {
        @ParentCommand
        RepositoryPluginCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Parameters(index = "1", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        @Option(names = "--force", description = "Force installation when the target plugin version conflicts with installed tool dependency ranges.")
        boolean force;

        @Override
        public Integer call() {
            return submitRepositoryPlugin(parent.root(), repositoryId, pluginId, "install", force);
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = "Update an installed plugin from a repository.")
    static class UpdateRepositoryPlugin implements Callable<Integer> {
        @ParentCommand
        RepositoryPluginCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Parameters(index = "1", paramLabel = "<pluginId>", description = "Plugin ID.")
        String pluginId;

        @Option(names = "--force", description = "Force update when the target plugin version conflicts with installed tool dependency ranges.")
        boolean force;

        @Override
        public Integer call() {
            return submitRepositoryPlugin(parent.root(), repositoryId, pluginId, "update", force);
        }
    }

    @Command(name = "publish", mixinStandardHelpOptions = true, description = {
            "Publish an installed plugin into a repository.",
            "--file is required and must provide a JSON object matching the /api/repositories/{repositoryId}/publish-plugin request body.",
            "Use --file=- to read from stdin."
    })
    static class PublishRepositoryPlugin implements Callable<Integer> {
        @ParentCommand
        RepositoryPluginCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Option(names = "--file", required = true, description = "Path to the publish request JSON file. Use - to read from stdin.")
        String filePath;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            String body = JsonInputSupport.readRequiredJsonObject(root.output(), root.objectMapper(), filePath, "Repository plugin publish request body");
            return root.emit(root.apiClient().postJson(
                    "/api/repositories/" + root.encodePath(repositoryId) + "/publish-plugin",
                    Map.of(),
                    body
            ));
        }
    }

    static int submitToolInstall(ActionDockCommand root,
                                 String repositoryId,
                                 String toolId,
                                 String operation,
                                 boolean installSchedules,
                                 boolean installPluginDependencies,
                                 boolean forcePluginUpgrade) {
        return root.emit(root.apiClient().postJson(
                "/api/repositories/" + root.encodePath(repositoryId) + "/tools/" + root.encodePath(toolId) + "/" + operation,
                Map.of(),
                root.jsonObject(Map.of(
                        "installSchedules", installSchedules,
                        "installPluginDependencies", installPluginDependencies,
                        "forcePluginUpgrade", forcePluginUpgrade
                ))
        ));
    }

    static int submitRepositoryPlugin(ActionDockCommand root,
                                      String repositoryId,
                                      String pluginId,
                                      String operation,
                                      boolean force) {
        return root.emit(root.apiClient().postJson(
                "/api/repositories/" + root.encodePath(repositoryId) + "/plugins/" + root.encodePath(pluginId) + "/" + operation,
                Map.of(),
                root.jsonObject(Map.of("force", force))
        ));
    }
}
