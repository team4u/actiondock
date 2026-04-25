package org.team4u.scriptflow.cli;

import picocli.CommandLine;

/**
 * ScriptFlow CLI 应用入口，基于 Picocli 构建命令行交互。
 *
 * @author jay.wu
 */
public final class ScriptFlowCliApplication {
    private ScriptFlowCliApplication() {
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
        ScriptFlowCommand root = new ScriptFlowCommand();
        CommandLine commandLine = new CommandLine(root);
        commandLine.setCaseInsensitiveEnumValuesAllowed(true);
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
            CliException cliException = CliException.validation(root.output(), exception.getMessage());
            cliException.writeTo(root.output());
            return cliException.exitCode();
        });
        int exitCode = commandLine.execute(args);
        System.exit(exitCode);
    }
}
