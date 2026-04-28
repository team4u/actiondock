package org.team4u.actiondock.cli;

import picocli.CommandLine;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * ActionDock CLI 应用入口，基于 Picocli 构建命令行交互。
 *
 * @author jay.wu
 */
public final class ActionDockCliApplication {
    private static final Pattern QUOTED_OPTION = Pattern.compile("'(--[^']+)'");

    private ActionDockCliApplication() {
    }

    /**
     * CLI 应用入口方法。
     * <p>
     * 初始化 Picocli 命令行框架，注册全局异常处理器，
     * 执行命令并根据退出码结束进程。
     *
     * @param args 命令行参数
     */
    public static void main(String[] args) {
        ActionDockCommand root = new ActionDockCommand();
        CommandLine commandLine = createCommandLine(root);
        int exitCode = commandLine.execute(args);
        System.exit(exitCode);
    }

    static CommandLine createCommandLine(ActionDockCommand root) {
        CommandLine commandLine = new CommandLine(root);
        commandLine.setCaseInsensitiveEnumValuesAllowed(true);
        commandLine.setExecutionStrategy(parseResult -> {
            if (hasHelpJson(parseResult)) {
                CommandLine target = parseResult.asCommandLineList().get(parseResult.asCommandLineList().size() - 1);
                root.emitLocalSuccess(CliAgentMetadata.help(root.objectMapper(), target.getCommandSpec()));
                return 0;
            }
            int exitCode = new CommandLine.RunLast().execute(parseResult);
            CliUpdateNotifier.maybeNotify(root, parseResult, exitCode);
            return exitCode;
        });
        commandLine.setExecutionExceptionHandler((exception, cmd, parseResult) -> {
            CliOutput output = root.output();
            if (exception instanceof CliException cliException) {
                cliException.writeTo(output);
                return cliException.exitCode();
            }
            CliException cliException = CliException.transport(output, exception.getMessage() == null ? "Command execution failed" : exception.getMessage());
            cliException.writeTo(output);
            return cliException.exitCode();
        });
        commandLine.setParameterExceptionHandler((exception, args1) -> {
            String command = exception.getCommandLine() == null ? "actiondock" : exception.getCommandLine().getCommandSpec().qualifiedName();
            String message = exception.getMessage();
            if (message != null && message.startsWith("Missing required option")) {
                CliException cliException = CliException.validation(
                        root.output(),
                        message,
                        CliErrorDetails.missingRequired(root.output(), command, quotedOptions(message), List.of(), List.of(command + " --help"))
                );
                cliException.writeTo(root.output());
                return cliException.exitCode();
            }
            CliException cliException = CliException.validation(
                    root.output(),
                    message,
                    CliErrorDetails.parseError(root.output(), exception.getCommandLine(), message)
            );
            cliException.writeTo(root.output());
            return cliException.exitCode();
        });
        return commandLine;
    }

    private static List<String> quotedOptions(String message) {
        List<String> options = new ArrayList<>();
        Matcher matcher = QUOTED_OPTION.matcher(message);
        while (matcher.find()) {
            options.add(matcher.group(1));
        }
        return options;
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
}
