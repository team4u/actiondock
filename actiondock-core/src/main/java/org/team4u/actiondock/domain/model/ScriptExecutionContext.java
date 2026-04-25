package org.team4u.actiondock.domain.model;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 脚本执行上下文，在脚本执行过程中传递的运行时信息。
 * <p>
 * 上下文对象封装了执行相关的元数据，包括执行ID和提交模式。
 * 由脚本引擎在执行时创建并传递给被执行的脚本。
 *
 * @author jay.wu
 */
public class ScriptExecutionContext {
    private String executionId;
    private SubmitMode submitMode;
    private ScriptExecutionLogger logger = ScriptExecutionLogger.noop();
    private Map<String, String> config = Map.of();
    private List<String> scriptStack = List.of();
    private String logPrefix = "";

    public String getExecutionId() {
        return executionId;
    }

    public ScriptExecutionContext setExecutionId(String executionId) {
        this.executionId = executionId;
        return this;
    }

    public SubmitMode getSubmitMode() {
        return submitMode;
    }

    public ScriptExecutionContext setSubmitMode(SubmitMode submitMode) {
        this.submitMode = submitMode;
        return this;
    }

    public ScriptExecutionLogger getLogger() {
        return logger;
    }

    public ScriptExecutionContext setLogger(ScriptExecutionLogger logger) {
        this.logger = logger == null ? ScriptExecutionLogger.noop() : logger;
        return this;
    }

    public Map<String, String> getConfig() {
        return config;
    }

    public ScriptExecutionContext setConfig(Map<String, String> config) {
        this.config = config == null ? Map.of() : Map.copyOf(new LinkedHashMap<>(config));
        return this;
    }

    public List<String> getScriptStack() {
        return scriptStack;
    }

    public ScriptExecutionContext setScriptStack(List<String> scriptStack) {
        this.scriptStack = scriptStack == null ? List.of() : List.copyOf(scriptStack);
        return this;
    }

    public String getLogPrefix() {
        return logPrefix;
    }

    public ScriptExecutionContext setLogPrefix(String logPrefix) {
        this.logPrefix = logPrefix == null ? "" : logPrefix;
        return this;
    }

    /**
     * 记录一条执行日志。
     * <p>
     * 自动在消息前拼接当前配置的日志前缀（logPrefix），便于在嵌套脚本调用场景下
     * 区分日志来源。日志通过内部持有的 {@link ScriptExecutionLogger} 输出，
     * 若未配置 logger 则默认丢弃（noop）。
     *
     * @param level   日志级别
     * @param message 日志内容，将被自动拼接前缀后输出
     */
    public void log(ExecutionLogLevel level, String message) {
        logger.log(level, (logPrefix == null ? "" : logPrefix) + message);
    }

    /**
     * 脚本执行日志输出接口。
     * <p>
     * 作为日志的抽象出口，由基础设施层注入具体实现（如写入数据库或标准输出）。
     * 默认使用 {@link #noop()} 静默丢弃所有日志，确保未配置时不产生副作用。
     */
    @FunctionalInterface
    public interface ScriptExecutionLogger {
        /**
         * 输出一条指定级别的日志。
         *
         * @param level   日志级别
         * @param message 已拼接前缀的完整日志内容
         */
        void log(ExecutionLogLevel level, String message);

        /**
         * 创建一个静默丢弃所有日志的空实现。
         * <p>
         * 用于不需要记录日志的场景（如测试或临时执行），避免调用方进行空判断。
         *
         * @return 不执行任何操作的日志器实例
         */
        static ScriptExecutionLogger noop() {
            return (level, message) -> {
            };
        }
    }
}
