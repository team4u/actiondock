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

/**
 * 仓库命令组，提供仓库定义、仓库工具和仓库插件的 REST CLI 入口。
 *
 * @author jay.wu
 */
@Command(name = "repositories", mixinStandardHelpOptions = true, description = "Commands for repository definitions, tools, and repository plugins.", subcommands = {
        RepositoriesCommands.ListRepositories.class,
        RepositoriesCommands.CreateRepository.class,
        RepositoriesCommands.UpdateRepository.class,
        RepositoriesCommands.DeleteRepository.class,
        RepositoriesCommands.SyncRepository.class,
        RepositoriesCommands.RepositoryToolCommands.class,
        RepositoriesCommands.RepositoryPluginCommands.class
})
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
            "Purpose:",
            "  Create a repository definition.",
            "Required:",
            "  --file <path|-> repository definition JSON object.",
            "Examples:",
            "  actiondock repositories create --file repository.json",
            "Input JSON shape:",
            "  {\"id\":\"repo-main\",\"name\":\"Main\",\"type\":\"LOCAL_DIR\",\"url\":\"/tmp/actiondock-repo\",\"branch\":\"main\",\"enabled\":true,\"trustLevel\":\"TRUSTED\",\"usage\":\"DISTRIBUTION\",\"description\":\"Main repository\"}",
            "Output JSON shape:",
            "  {\"status\":0,\"msg\":\"Success\",\"data\":{\"id\":\"repo-main\",...}}",
            "Recoverable errors:",
            "  status=2 means invalid CLI input or JSON. status=5 means server validation failed."
    })
    static class CreateRepository implements Callable<Integer> {
        @ParentCommand
        RepositoriesCommands parent;

        @Option(names = "--file", required = true, description = "Path to the repository definition JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without creating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            String body = JsonInputSupport.readRequiredJsonObject(parent.root().output(), parent.root().objectMapper(), filePath, "Repository definition");
            return parent.root().submitRequest(
                    CliRequest.postJson("/api/repositories", Map.of(), body),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock repositories create")
            );
        }
    }

    @Command(name = "update", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Update a repository definition.",
            "Required:",
            "  <repositoryId>",
            "  --file <path|-> repository definition JSON object.",
            "Examples:",
            "  actiondock repositories update repo-main --file repository.json",
            "Input JSON shape:",
            "  {\"id\":\"repo-main\",\"name\":\"Main\",\"type\":\"LOCAL_DIR\",\"url\":\"/tmp/actiondock-repo\",\"branch\":\"main\",\"enabled\":true,\"trustLevel\":\"TRUSTED\",\"usage\":\"DISTRIBUTION\",\"description\":\"Main repository\"}",
            "Recoverable errors:",
            "  status=2 means invalid CLI input or JSON. status=5 means server validation failed."
    })
    static class UpdateRepository implements Callable<Integer> {
        @ParentCommand
        RepositoriesCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Option(names = "--file", required = true, description = "Path to the repository definition JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without updating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            String body = JsonInputSupport.readRequiredJsonObject(root.output(), root.objectMapper(), filePath, "Repository definition");
            return root.submitRequest(
                    CliRequest.putJson("/api/repositories/" + root.encodePath(repositoryId), Map.of(), body),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock repositories update")
            );
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete a repository definition.")
    static class DeleteRepository implements Callable<Integer> {
        @ParentCommand
        RepositoriesCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without deleting.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return parent.root().submitRequest(
                    CliRequest.delete("/api/repositories/" + parent.root().encodePath(repositoryId), Map.of()),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock repositories delete")
            );
        }
    }

    @Command(name = "sync", mixinStandardHelpOptions = true, description = "Sync a repository catalog.")
    static class SyncRepository implements Callable<Integer> {
        @ParentCommand
        RepositoriesCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without syncing.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return parent.root().submitRequest(
                    CliRequest.postJson("/api/repositories/" + parent.root().encodePath(repositoryId) + "/sync", Map.of(), "{}"),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock repositories sync")
            );
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

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without installing.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return submitToolInstall(parent.root(), repositoryId, toolId, "install", installSchedules, installPluginDependencies, forcePluginUpgrade, dryRun, validateOnly);
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

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without updating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return submitToolInstall(parent.root(), repositoryId, toolId, "update", installSchedules, installPluginDependencies, forcePluginUpgrade, dryRun, validateOnly);
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

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without syncing.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            Map<String, Object> body = new LinkedHashMap<>();
            if (scriptId != null && !scriptId.isBlank()) {
                body.put("scriptId", scriptId);
            }
            return root.submitRequest(
                    CliRequest.postJson("/api/repositories/" + root.encodePath(repositoryId) + "/tools/" + root.encodePath(toolId) + "/develop", Map.of(), root.jsonObject(body)),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock repositories tools develop")
            );
        }
    }

    @Command(name = "publish", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Publish a local script into a repository.",
            "Required:",
            "  <repositoryId>",
            "  --file <path|-> repository tool publish request JSON object.",
            "Examples:",
            "  actiondock repositories tools publish repo-main --file publish.json",
            "Input JSON shape:",
            "  {\"scriptId\":\"hello\",\"toolId\":\"hello\",\"displayName\":\"Hello\",\"version\":\"1.0.0\",\"owner\":\"team4u\",\"releaseNotes\":\"Initial release\",\"tags\":[\"demo\"],\"scheduleIds\":[],\"configItems\":[],\"force\":false}",
            "Recoverable errors:",
            "  status=2 means invalid CLI input or JSON. status=5 means server validation failed."
    })
    static class PublishRepositoryTool implements Callable<Integer> {
        @ParentCommand
        RepositoryToolCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Option(names = "--file", required = true, description = "Path to the publish request JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without publishing.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            String body = JsonInputSupport.readRequiredJsonObject(root.output(), root.objectMapper(), filePath, "Repository tool publish request body");
            return root.submitRequest(
                    CliRequest.postJson("/api/repositories/" + root.encodePath(repositoryId) + "/publish", Map.of(), body),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock repositories tools publish")
            );
        }
    }

    @Command(name = "uninstall", mixinStandardHelpOptions = true, description = "Uninstall an installed repository tool by its installed script ID.")
    static class UninstallRepositoryTool implements Callable<Integer> {
        @ParentCommand
        RepositoryToolCommands parent;

        @Parameters(index = "0", paramLabel = "<scriptId>", description = "Installed script ID.")
        String scriptId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without uninstalling.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return parent.root().submitRequest(
                    CliRequest.delete("/api/installed-tools/" + parent.root().encodePath(scriptId), Map.of()),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock repositories tools uninstall")
            );
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

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without installing.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return submitRepositoryPlugin(parent.root(), repositoryId, pluginId, "install", force, dryRun, validateOnly);
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

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without updating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            return submitRepositoryPlugin(parent.root(), repositoryId, pluginId, "update", force, dryRun, validateOnly);
        }
    }

    @Command(name = "publish", mixinStandardHelpOptions = true, description = {
            "Purpose:",
            "  Publish an installed plugin into a repository.",
            "Required:",
            "  <repositoryId>",
            "  --file <path|-> repository plugin publish request JSON object.",
            "Examples:",
            "  actiondock repositories plugins publish repo-main --file plugin-publish.json",
            "Input JSON shape:",
            "  {\"pluginId\":\"demo-plugin\",\"displayName\":\"Demo Plugin\",\"version\":\"1.0.0\",\"owner\":\"team4u\",\"description\":\"Demo\",\"releaseNotes\":\"Initial release\",\"tags\":[\"demo\"],\"riskLevel\":\"LOW\",\"artifact\":{\"uri\":\"local://plugins/demo.jar\",\"sha256\":\"...\",\"fileName\":\"demo.jar\"}}",
            "Recoverable errors:",
            "  status=2 means invalid CLI input or JSON. status=5 means server validation failed."
    })
    static class PublishRepositoryPlugin implements Callable<Integer> {
        @ParentCommand
        RepositoryPluginCommands parent;

        @Parameters(index = "0", paramLabel = "<repositoryId>", description = "Repository ID.")
        String repositoryId;

        @Option(names = "--file", required = true, description = "Path to the publish request JSON file. Use - to read from stdin.")
        String filePath;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without publishing.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments and JSON payload without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            String body = JsonInputSupport.readRequiredJsonObject(root.output(), root.objectMapper(), filePath, "Repository plugin publish request body");
            return root.submitRequest(
                    CliRequest.postJson("/api/repositories/" + root.encodePath(repositoryId) + "/publish-plugin", Map.of(), body),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock repositories plugins publish")
            );
        }
    }

    static int submitToolInstall(ActionDockCommand root,
                                 String repositoryId,
                                 String toolId,
                                 String operation,
                                 boolean installSchedules,
                                 boolean installPluginDependencies,
                                 boolean forcePluginUpgrade,
                                 boolean dryRun,
                                 boolean validateOnly) {
        return root.submitRequest(
                CliRequest.postJson("/api/repositories/" + root.encodePath(repositoryId) + "/tools/" + root.encodePath(toolId) + "/" + operation, Map.of(), root.jsonObject(Map.of(
                        "installSchedules", installSchedules,
                        "installPluginDependencies", installPluginDependencies,
                        "forcePluginUpgrade", forcePluginUpgrade
                ))),
                AgentExecutionOptions.of(dryRun, validateOnly, "actiondock repositories tools " + operation)
        );
    }

    static int submitRepositoryPlugin(ActionDockCommand root,
                                      String repositoryId,
                                      String pluginId,
                                      String operation,
                                      boolean force,
                                      boolean dryRun,
                                      boolean validateOnly) {
        return root.submitRequest(
                CliRequest.postJson("/api/repositories/" + root.encodePath(repositoryId) + "/plugins/" + root.encodePath(pluginId) + "/" + operation, Map.of(), root.jsonObject(Map.of("force", force))),
                AgentExecutionOptions.of(dryRun, validateOnly, "actiondock repositories plugins " + operation)
        );
    }
}
