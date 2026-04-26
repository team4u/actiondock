package org.team4u.actiondock.cli;

import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.ParentCommand;

import java.util.concurrent.Callable;

@Command(name = "discover", mixinStandardHelpOptions = true, description = {
        "Return machine-readable ActionDock CLI capabilities and recommended agent flows."
})
class DiscoverCommands implements Callable<Integer> {
    @ParentCommand
    ActionDockCommand root;

    @Option(names = "--json", description = "Return JSON discovery output. JSON is already the default output format.")
    boolean json;

    @Override
    public Integer call() {
        return root.emitLocalSuccess(CliAgentMetadata.discover(root.objectMapper(), root.spec.commandLine()));
    }
}
