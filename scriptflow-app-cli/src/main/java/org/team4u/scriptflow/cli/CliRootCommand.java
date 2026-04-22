package org.team4u.scriptflow.cli;

import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;

@Component
@Command(
        name = "dsl-runtime",
        mixinStandardHelpOptions = true,
        subcommands = {ScriptCommands.class, RunCommand.class, PluginCommands.class}
)
public class CliRootCommand implements Runnable {
    @Override
    public void run() {
        System.out.println("Use subcommands: script | run | plugin");
    }
}
