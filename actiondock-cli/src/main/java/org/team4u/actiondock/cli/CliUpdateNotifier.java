package org.team4u.actiondock.cli;

import picocli.CommandLine;

/**
 * CLI 更新提醒控制器。
 */
final class CliUpdateNotifier {
    private CliUpdateNotifier() {
    }

    static void maybeNotify(ActionDockCommand root, CommandLine.ParseResult parseResult, int exitCode) {
        if (exitCode != 0 || !shouldNotify(parseResult)) {
            return;
        }
        root.services.updateNoticeProvider().get()
                .map(notification -> notification.message() + System.lineSeparator())
                .ifPresent(root.services.stderr()::print);
    }

    private static boolean shouldNotify(CommandLine.ParseResult parseResult) {
        if (parseResult == null || hasHelpRequest(parseResult) || hasHelpJson(parseResult)) {
            return false;
        }
        CommandLine.ParseResult deepest = deepest(parseResult);
        return deepest.commandSpec().subcommands().isEmpty();
    }

    private static boolean hasHelpRequest(CommandLine.ParseResult parseResult) {
        CommandLine.ParseResult current = parseResult;
        while (current != null) {
            if (current.isUsageHelpRequested() || current.isVersionHelpRequested()) {
                return true;
            }
            current = current.hasSubcommand() ? current.subcommand() : null;
        }
        return false;
    }

    private static boolean hasHelpJson(CommandLine.ParseResult parseResult) {
        CommandLine.ParseResult current = parseResult;
        while (current != null) {
            if (current.hasMatchedOption("--help-json")) {
                return true;
            }
            current = current.hasSubcommand() ? current.subcommand() : null;
        }
        return false;
    }

    private static CommandLine.ParseResult deepest(CommandLine.ParseResult parseResult) {
        CommandLine.ParseResult current = parseResult;
        while (current.hasSubcommand()) {
            current = current.subcommand();
        }
        return current;
    }
}
