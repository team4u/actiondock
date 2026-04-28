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

@Command(name = "access-tokens", mixinStandardHelpOptions = true, description = "Commands for API access token management.", subcommands = {
        AccessTokenCommands.ListAccessTokens.class,
        AccessTokenCommands.CreateAccessToken.class,
        AccessTokenCommands.RenameAccessToken.class,
        AccessTokenCommands.EnableAccessToken.class,
        AccessTokenCommands.DisableAccessToken.class,
        AccessTokenCommands.DeleteAccessToken.class
})
class AccessTokenCommands implements Runnable {
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

    @Command(name = "list", mixinStandardHelpOptions = true, description = "List API access tokens.")
    static class ListAccessTokens implements Callable<Integer> {
        @ParentCommand
        AccessTokenCommands parent;

        @Override
        public Integer call() {
            return parent.root().emit(parent.root().apiClient().get("/api/access-tokens", Map.of()));
        }
    }

    @Command(name = "create", mixinStandardHelpOptions = true, description = {
            "Create an API access token.",
            "Use --name to set a display name. The server may accept an empty name."
    })
    static class CreateAccessToken implements Callable<Integer> {
        @ParentCommand
        AccessTokenCommands parent;

        @Option(names = "--name", description = "Optional token display name.")
        String name;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without creating.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            Map<String, Object> body = new LinkedHashMap<>();
            if (name != null) {
                body.put("name", name);
            }
            return parent.root().submitRequest(
                    CliRequest.postJson("/api/access-tokens", Map.of(), parent.root().jsonObject(body)),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock access-tokens create")
            );
        }
    }

    @Command(name = "rename", mixinStandardHelpOptions = true, description = "Rename an API access token.")
    static class RenameAccessToken implements Callable<Integer> {
        @ParentCommand
        AccessTokenCommands parent;

        @Parameters(index = "0", paramLabel = "<tokenId>", description = "Token ID.")
        String tokenId;

        @Option(names = "--name", required = true, description = "New token display name.")
        String name;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without renaming.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.submitRequest(
                    CliRequest.putJson("/api/access-tokens/" + root.encodePath(tokenId), Map.of(), root.jsonObject(Map.of("name", name))),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock access-tokens rename")
            );
        }
    }

    @Command(name = "enable", mixinStandardHelpOptions = true, description = "Enable an API access token.")
    static class EnableAccessToken implements Callable<Integer> {
        @ParentCommand
        AccessTokenCommands parent;

        @Parameters(index = "0", paramLabel = "<tokenId>", description = "Token ID.")
        String tokenId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without enabling.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.submitRequest(
                    CliRequest.postJson("/api/access-tokens/" + root.encodePath(tokenId) + "/enable", Map.of(), "{}"),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock access-tokens enable")
            );
        }
    }

    @Command(name = "disable", mixinStandardHelpOptions = true, description = "Disable an API access token.")
    static class DisableAccessToken implements Callable<Integer> {
        @ParentCommand
        AccessTokenCommands parent;

        @Parameters(index = "0", paramLabel = "<tokenId>", description = "Token ID.")
        String tokenId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without disabling.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.submitRequest(
                    CliRequest.postJson("/api/access-tokens/" + root.encodePath(tokenId) + "/disable", Map.of(), "{}"),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock access-tokens disable")
            );
        }
    }

    @Command(name = "delete", mixinStandardHelpOptions = true, description = "Delete an API access token.")
    static class DeleteAccessToken implements Callable<Integer> {
        @ParentCommand
        AccessTokenCommands parent;

        @Parameters(index = "0", paramLabel = "<tokenId>", description = "Token ID.")
        String tokenId;

        @Option(names = "--dry-run", description = "Validate local input and print the final HTTP request preview without deleting.")
        boolean dryRun;

        @Option(names = "--validate-only", description = "Validate local CLI arguments without creating an HTTP client.")
        boolean validateOnly;

        @Override
        public Integer call() {
            ActionDockCommand root = parent.root();
            return root.submitRequest(
                    CliRequest.delete("/api/access-tokens/" + root.encodePath(tokenId), Map.of()),
                    AgentExecutionOptions.of(dryRun, validateOnly, "actiondock access-tokens delete")
            );
        }
    }
}
