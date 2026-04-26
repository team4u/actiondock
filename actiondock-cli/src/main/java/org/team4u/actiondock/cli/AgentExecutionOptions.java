package org.team4u.actiondock.cli;

import java.util.List;

/**
 * Agent-oriented execution controls for REST write commands.
 */
record AgentExecutionOptions(boolean dryRun, boolean validateOnly, String command) {
    static AgentExecutionOptions of(boolean dryRun, boolean validateOnly, String command) {
        return new AgentExecutionOptions(dryRun, validateOnly, command);
    }

    void validate(CliOutput output) {
        if (dryRun && validateOnly) {
            throw CliException.validation(
                    output,
                    "--dry-run cannot be combined with --validate-only",
                    CliErrorDetails.mutuallyExclusive(output, command, List.of("--dry-run", "--validate-only"), List.of(
                            command + " --dry-run",
                            command + " --validate-only"
                    ))
            );
        }
    }
}
