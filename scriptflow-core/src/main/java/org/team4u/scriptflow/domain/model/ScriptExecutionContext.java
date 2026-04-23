package org.team4u.scriptflow.domain.model;

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

    public void log(ExecutionLogLevel level, String message) {
        logger.log(level, (logPrefix == null ? "" : logPrefix) + message);
    }

    @FunctionalInterface
    public interface ScriptExecutionLogger {
        void log(ExecutionLogLevel level, String message);

        static ScriptExecutionLogger noop() {
            return (level, message) -> {
            };
        }
    }
}
